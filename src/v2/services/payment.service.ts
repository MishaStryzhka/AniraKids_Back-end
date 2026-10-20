import Joi = require('joi');
import { Types } from 'mongoose';
import { ReservationV2Model } from '../models/reservation-v2.model';
import type { Reservation } from '../types/domain';
import { BOOKING_POLICY, isValidCzechIban } from './booking-policy';
import { PaymentError, PAYMENT_ENTRY_TYPES, type PaymentInput, type PaymentEntry } from './payment.types';

const inputSchema = Joi.object({
  operationId: Joi.string().guid({ version: ['uuidv4'] }).required(),
  expectedRevision: Joi.number().integer().min(0).max(1000).required(),
  type: Joi.string().valid(...PAYMENT_ENTRY_TYPES).required(),
  amount: Joi.number().integer().min(1).max(1000000).required(),
  method: Joi.string().valid('bank_transfer', 'cash', 'card'),
  reference: Joi.string().max(120), note: Joi.string().max(500),
}).unknown(false);

export const parsePaymentInput = (body: unknown): PaymentInput => {
  const { value, error } = inputSchema.validate(body, { convert: false });
  if (error || !value) throw new PaymentError('VALIDATION_ERROR', 400);
  const input = value as PaymentInput;
  const fee = input.type.startsWith('cancellation_');
  if ((fee && input.method !== undefined) || (!fee && !input.method)) throw new PaymentError('VALIDATION_ERROR', 400);
  if ((fee || input.type.endsWith('_refunded')) && (!input.note || input.note.trim().length < 5)) throw new PaymentError('VALIDATION_ERROR', 400);
  return { ...input, operationId: input.operationId.toLowerCase(),
    ...(input.reference ? { reference: input.reference.trim() } : {}),
    ...(input.note ? { note: input.note.trim() } : {}),
  };
};

export const paymentSummary = (r: Reservation & { _id?: Types.ObjectId }) => {
  const entries = r.paymentEntries ?? [];
  const sum = (...types: string[]) => entries.filter(e => types.includes(e.type)).reduce((n, e) => n + e.amount, 0);
  const rentalReceived = sum('advance_received', 'rental_received');
  const rentalRefunded = sum('rental_refunded');
  const rentalNet = rentalReceived - rentalRefunded;
  const depositReceived = sum('deposit_received'), depositRefunded = sum('deposit_refunded');
  const cancellationFee = sum('cancellation_fee') - sum('cancellation_fee_reversed');
  const advanceRequired = r.advanceRequired ?? 0;
  // Historical fittingDiscount stores the paid fitting already deducted from
  // subtotal. It covers the advance too; never subtract it from rentalBalance
  // again or create a second receipt for money recorded on the fitting.
  const fittingCredit = r.fittingDiscount?.amount ?? 0;
  return {
    reservationId: r._id?.toHexString() ?? '', revision: r.paymentRevision ?? 0,
    currency: 'CZK' as const, advanceRequired, fittingCredit, rentalTotal: r.subtotal, depositRequired: r.deposit,
    rentalReceived, rentalRefunded, rentalNet, depositReceived, depositRefunded,
    depositHeld: depositReceived - depositRefunded, cancellationFee,
    rentalBalance: r.status === 'cancelled' ? 0 : Math.max(0, r.subtotal - rentalNet),
    advanceBalance: r.status === 'cancelled' ? 0 : Math.max(0, advanceRequired - rentalNet - fittingCredit),
    refundableRental: rentalNet - cancellationFee,
    legacyUnreconciled: entries.length === 0 && r.paymentStatus !== 'unpaid' && !r.fittingDiscount,
    entries: entries.map(e => ({ operationId: e.operationId, type: e.type, amount: e.amount,
      ...(e.method ? { method: e.method } : {}), ...(e.reference ? { reference: e.reference } : {}),
      ...(e.note ? { note: e.note } : {}), recordedAt: new Date(e.recordedAt).toISOString(), recordedBy: e.recordedBy })),
  };
};

export const publicPaymentSummary = (r: Reservation) => {
  if (r.advanceRequired === undefined) return null;
  const s = paymentSummary(r);
  const pendingPayable = r.status === 'pending' && r.expiresAt instanceof Date && r.expiresAt.getTime() > Date.now();
  const payable = !s.legacyUnreconciled && (pendingPayable || r.status === 'confirmed' || r.status === 'prepared');
  const message = r.reservationNumber;
  const instructions = (amount: number, allowed: boolean) =>
    allowed && amount > 0 && isValidCzechIban(BOOKING_POLICY.bank.iban)
      ? { ...BOOKING_POLICY.bank, amount, currency: 'CZK' as const, message,
        qrPayload: `SPD*1.0*ACC:${BOOKING_POLICY.bank.iban}*AM:${amount.toFixed(2)}*CC:CZK*MSG:${message}*PT:IP` }
      : null;
  // Keep the original advance contract for older storefront versions.
  const paymentInstructions = instructions(s.advanceBalance, payable && pendingPayable);
  const fullPaymentInstructions = instructions(s.rentalBalance + Math.max(0, s.depositRequired - s.depositHeld), payable);
  return { advanceRequired: s.advanceRequired, advanceBalance: s.advanceBalance,
    rentalBalance: s.rentalBalance, depositRequired: s.depositRequired, depositHeld: s.depositHeld,
    paymentInstructions, fullPaymentInstructions };
};

export const validatePaymentChange = (r: Reservation, input: PaymentInput): void => {
  const s = paymentSummary(r);
  if (s.legacyUnreconciled) throw new PaymentError('PAYMENT_LEGACY_RECONCILIATION_REQUIRED');
  if ((r.paymentEntries?.length ?? 0) >= 500) throw new PaymentError('PAYMENT_LIMIT_EXCEEDED');
  const fee = input.type.startsWith('cancellation_');
  if (fee && r.status !== 'cancelled') throw new PaymentError('PAYMENT_NOT_ALLOWED');
  // Late transfers still have to be recorded and refunded, without reviving a booking.
  if (input.type.endsWith('_received') && r.status === 'cancelled' && (!input.note || input.note.trim().length < 5)) throw new PaymentError('PAYMENT_NOT_ALLOWED');
  const amount = input.amount;
  if (input.type === 'deposit_received' && amount < r.deposit - s.depositHeld)
    throw new PaymentError('PAYMENT_FULL_DEPOSIT_REQUIRED');
  const invalid =
    (input.type === 'advance_received' && amount > Math.max(0, (r.advanceRequired ?? Math.min(200, r.subtotal)) - s.rentalNet - s.fittingCredit)) ||
    (input.type === 'rental_received' && amount > r.subtotal - s.rentalNet) ||
    (input.type === 'deposit_received' && amount > r.deposit - s.depositHeld) ||
    (input.type === 'rental_refunded' && amount > s.refundableRental) ||
    (input.type === 'deposit_refunded' && amount > s.depositHeld) ||
    (input.type === 'cancellation_fee' && (amount > 200 - s.cancellationFee || amount > s.refundableRental)) ||
    (input.type === 'cancellation_fee_reversed' && amount > s.cancellationFee);
  if (invalid) throw new PaymentError('PAYMENT_LIMIT_EXCEEDED');
};

const sameOperation = (entry: PaymentEntry, input: PaymentInput): boolean =>
  entry.type === input.type && entry.amount === input.amount && entry.method === input.method &&
  (entry.reference ?? '') === (input.reference ?? '') && (entry.note ?? '') === (input.note ?? '');

export const readPayments = async (id: Types.ObjectId) => {
  const r = await ReservationV2Model.findById(id).lean().exec();
  if (!r) throw new PaymentError('RESERVATION_NOT_FOUND', 404);
  return paymentSummary(r);
};

export const recordPayment = async (id: Types.ObjectId, input: PaymentInput, actor: string, fittingCreditId?: string, fittingPartner?:import('./partner-referral.service').PartnerAttribution) => {
  const r = await ReservationV2Model.findById(id).lean().exec();
  if (!r) throw new PaymentError('RESERVATION_NOT_FOUND', 404);
  const existing = r.paymentEntries?.find(e => e.operationId === input.operationId);
  if (existing) {
    if (!sameOperation(existing, input)) throw new PaymentError('PAYMENT_IDEMPOTENCY_CONFLICT');
    return paymentSummary(r);
  }
  if ((r.paymentRevision ?? 0) !== input.expectedRevision) throw new PaymentError('PAYMENT_CONFLICT');
  validatePaymentChange(r, input);
  const { expectedRevision, ...financial } = input;
  const entry: PaymentEntry = { ...financial, recordedAt: new Date(), recordedBy: actor };
  const next = paymentSummary({ ...r, paymentEntries: [...(r.paymentEntries ?? []), entry] });
  const paymentStatus = next.rentalNet === 0 && next.depositHeld === 0 && (next.rentalRefunded + next.depositRefunded > 0)
    ? 'refunded' : next.rentalNet >= r.subtotal && (next.depositHeld >= r.deposit || r.status === 'returned') && r.status !== 'cancelled' ? 'paid' : 'unpaid';
  // One atomic document write: audit, balances/status, revision and idempotency cannot split.
  const updated = await ReservationV2Model.findOneAndUpdate({
    _id: id, status: r.status, paymentStatus: r.paymentStatus,
    ...(fittingCreditId ? {fittingCreditId: {$exists:false}, ...(r.status === 'pending' ? {expiresAt: {$gt: new Date()}} : {})} : {}),
    ...(r.paymentRevision === undefined ? { paymentRevision: { $exists: false } } : { paymentRevision: expectedRevision }),
    'paymentEntries.operationId': { $ne: input.operationId },
  }, { $push: { paymentEntries: entry, partnerAudit: {action: input.type, at: entry.recordedAt, by: actor, operationId: input.operationId, amount: input.amount, method: input.method} }, $inc: { paymentRevision: 1 }, $set: { paymentStatus, ...(!r.invoiceAutomation && ['advance_received','rental_received'].includes(input.type) && r.status!=='cancelled' ? {invoiceAutomation:{status:'pending',requestedAt:entry.recordedAt,requestedBy:actor}} : {}), ...(fittingCreditId ? {fittingCreditId,...(fittingPartner?{partner:fittingPartner}:{})} : {}) } }, { new: true, runValidators: true }).lean().exec();
  if (updated) return paymentSummary(updated);
  const current = await ReservationV2Model.findById(id).lean().exec();
  const replay = current?.paymentEntries?.find(e => e.operationId === input.operationId);
  if (replay) {
    if (!sameOperation(replay, input)) throw new PaymentError('PAYMENT_IDEMPOTENCY_CONFLICT');
    return paymentSummary(current!);
  }
  throw new PaymentError('PAYMENT_CONFLICT');
};
