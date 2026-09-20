import type { Types } from 'mongoose';

import type {
  TrustedReservationIdempotencyContext,
} from '../services/reservation.types';

export interface JsonResponse {
  status(code: number): JsonResponse;
  json(body: unknown): unknown;
}

export interface HttpRequest {
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
  authenticatedUserId?: Types.ObjectId;
  reservationRequestNow?: Date;
  reservationIdempotencyKey?: string;
  reservationIdempotency?: TrustedReservationIdempotencyContext;
}

export type HttpNext = (error?: unknown) => unknown;

export type HttpHandler = (
  request: HttpRequest,
  response: JsonResponse,
  next: HttpNext
) => unknown;

export type HttpErrorHandler = (
  error: unknown,
  request: HttpRequest,
  response: JsonResponse,
  next: HttpNext
) => unknown;

export interface RouterLike {
  get(path: string, ...handlers: HttpHandler[]): RouterLike;
  post(path: string, ...handlers: HttpHandler[]): RouterLike;
  patch(path: string, ...handlers: HttpHandler[]): RouterLike;
  use(...handlers: Array<HttpHandler | HttpErrorHandler>): RouterLike;
}

export interface ExpressLike {
  Router(): RouterLike;
}
