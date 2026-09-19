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
      request.reservationRequestNow
        ? {
            now: request.reservationRequestNow,
          }
        : undefined
    );

    const publicResponse = toPublicCreateReservationResponse(result);

    console.log('V2 reservation created', {
      reservationNumber: publicResponse.reservation.reservationNumber,
      status: 201,
    });

    return response
      .status(201)
      .json(publicResponse);
  } catch (error) {
    return next(error);
  }
};
