import { Types } from 'mongoose';

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
    productId: new Types.ObjectId(body.productId),
    variantId: new Types.ObjectId(body.variantId),
    rentalMode: body.rentalMode,
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
    return next(error);
  }
};
