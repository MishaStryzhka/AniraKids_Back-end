import { Types } from 'mongoose';

import {
  toAdminReservationCalendarDto,
  toAdminReservationDetailDto,
  toAdminReservationListDto,
  toAdminReservationOperationDto,
} from '../http/admin-response';
import {
  reservationAdminService,
} from '../services/reservation-admin.service';
import type {
  ReservationAdminCalendarOptions,
  ReservationAdminCancelInput,
  ReservationAdminListOptions,
  ReservationAdminNotesInput,
} from '../services/reservation-admin.types';
import type {
  HttpHandler,
} from '../types/http';

const objectIdFromParam = (
  value: string | undefined
): Types.ObjectId => {
  if (!value) {
    throw new Error('Validated route parameter is missing');
  }

  return new Types.ObjectId(value);
};

export const listAdminReservations: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const result = await reservationAdminService.listReservations(
      request.query as unknown as ReservationAdminListOptions
    );

    return response
      .status(200)
      .json(toAdminReservationListDto(result));
  } catch (error) {
    return next(error);
  }
};

export const getAdminReservationDetail: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const result = await reservationAdminService.getReservationDetail(
      objectIdFromParam(request.params?.reservationId)
    );

    return response
      .status(200)
      .json(toAdminReservationDetailDto(result));
  } catch (error) {
    return next(error);
  }
};

export const getAdminReservationCalendar: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const result = await reservationAdminService.getCalendar(
      request.query as unknown as ReservationAdminCalendarOptions
    );

    return response
      .status(200)
      .json(toAdminReservationCalendarDto(result));
  } catch (error) {
    return next(error);
  }
};

export const updateAdminReservationNotes: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const reservation = await reservationAdminService.updateNotes(
      objectIdFromParam(request.params?.reservationId),
      request.body as ReservationAdminNotesInput
    );

    return response.status(200).json({
      reservation: toAdminReservationOperationDto(reservation),
    });
  } catch (error) {
    return next(error);
  }
};

export const confirmAdminReservation: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const reservation = await reservationAdminService.confirm(
      objectIdFromParam(request.params?.reservationId)
    );

    return response.status(200).json({
      reservation: toAdminReservationOperationDto(reservation),
    });
  } catch (error) {
    return next(error);
  }
};

export const prepareAdminReservation: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const reservation = await reservationAdminService.prepare(
      objectIdFromParam(request.params?.reservationId)
    );

    return response.status(200).json({
      reservation: toAdminReservationOperationDto(reservation),
    });
  } catch (error) {
    return next(error);
  }
};

export const rentAdminReservation: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const reservation = await reservationAdminService.rent(
      objectIdFromParam(request.params?.reservationId)
    );

    return response.status(200).json({
      reservation: toAdminReservationOperationDto(reservation),
    });
  } catch (error) {
    return next(error);
  }
};

export const returnAdminReservation: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const reservation = await reservationAdminService.returnReservation(
      objectIdFromParam(request.params?.reservationId)
    );

    return response.status(200).json({
      reservation: toAdminReservationOperationDto(reservation),
    });
  } catch (error) {
    return next(error);
  }
};

export const cancelAdminReservation: HttpHandler = async (
  request,
  response,
  next
) => {
  try {
    const reservation = await reservationAdminService.cancel(
      objectIdFromParam(request.params?.reservationId),
      request.body as ReservationAdminCancelInput
    );

    return response.status(200).json({
      reservation: toAdminReservationOperationDto(reservation),
    });
  } catch (error) {
    return next(error);
  }
};
