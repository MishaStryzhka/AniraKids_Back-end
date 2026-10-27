import {FittingDiscountError} from '../services/fitting-discount.service';
import { Types } from 'mongoose';
import {resolveBookingPartner,PartnerError} from '../services/partner-referral.service';

import {
  reservationService,
} from '../services/reservation.service';
import type {
  CreateReservationCommand,
} from '../services/reservation.types';
import type {
  HttpHandler,
} from '../types/http';
import type {
  ReservationRequestBody,
} from '../schemas/reservation.schema';
import {
  toPublicCreateReservationResponse,
} from '../http/reservation-response';

export const createReservation: HttpHandler = async (
  request,
  response,
  next
) => {
  const body = request.body as ReservationRequestBody;

  const command: CreateReservationCommand = {
    ...(body.items ? { items: body.items.map(item => ({
      productId: new Types.ObjectId(item.productId), variantId: new Types.ObjectId(item.variantId),
    })) } : {}),
    productId: new Types.ObjectId(body.productId),
    variantId: new Types.ObjectId(body.variantId),
    rentalMode: body.rentalMode,
      deliveryTariff:body.deliveryTariff,
      fulfillmentMethod: body.fulfillmentMethod,
      balikovnaPoint: body.balikovnaPoint,
      deliveryAddress: body.deliveryAddress,
    fittingDiscount: body.fittingDiscount,
    startDate: body.startDate,
    endDate: body.endDate,
    customer: body.customer,
  };

  if (request.authenticatedUserId) {
    command.customerId = request.authenticatedUserId;
  }

  if (body.notes !== undefined) {
    command.notes = body.notes;
  }

  try {
    command.partner=await resolveBookingPartner(body.referralToken);
    const result = await reservationService.createReservation(
      command,
      {
        now: request.reservationRequestNow,
        idempotency: request.reservationIdempotency,
      }
    );

    const publicResponse = toPublicCreateReservationResponse(result);
    const status = result.replayed ? 200 : 201;

    console.log('V2 reservation response', {
      reservationNumber: publicResponse.reservation.reservationNumber,
      status,
      replayed: result.replayed === true,
    });

    return response
      .status(status)
      .json(publicResponse);
  } catch (error) {
    if((error as any)?.code===11000&&(error as any)?.keyPattern?.fittingCreditId)return response.status(409).json({error:{code:'FITTING_DISCOUNT_UNAVAILABLE'}});
    if(error instanceof FittingDiscountError)return response.status(error.status).json({error:{code:error.code}});
    if(error instanceof PartnerError)return response.status(error.status).json({error:{code:error.code,message:error.code}});
    return next(error);
  }
};
