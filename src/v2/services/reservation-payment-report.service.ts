import Joi = require('joi');
import { Types } from 'mongoose';
import { ReservationV2Model } from '../models/reservation-v2.model';
import { paymentSummary, publicPaymentSummary } from './payment.service';
import { PaymentError } from './payment.types';
import { notifyOwnerReservationPaymentReported } from './admin-push.service';

const schema = Joi.object({
  operationId: Joi.string().guid({version:['uuidv4']}).required(),
  kind: Joi.string().valid('advance','full','cash').required(),
  amount: Joi.number().integer().min(1).max(1000000).required(),
}).unknown(false);

// Reporting a transfer never creates a receipt, changes a balance, confirms the
// reservation or extends its hold. Only staff can record money actually received.
export async function reportReservationPayment(
  number: string,
  access: {customerId: Types.ObjectId} | {guestAccessTokenHash: string},
  body: unknown,
  actor: string
) {
  const {value, error} = schema.validate(body, {convert:false});
  if (error) throw new PaymentError('VALIDATION_ERROR',400);
  const input = value as {operationId:string;kind:'advance'|'full'|'cash';amount:number};
  input.operationId = input.operationId.toLowerCase();
  const filter = {reservationNumber:number,...access};
  const r = await ReservationV2Model.findOne(filter).lean().exec();
  if (!r) throw new PaymentError('RESERVATION_NOT_FOUND',404);
  const replay = r.partnerAudit?.find(e => e.action === 'payment_reported' && e.operationId === input.operationId);
  if (replay) {
    if (replay.amount !== input.amount || replay.reference !== input.kind)
      throw new PaymentError('PAYMENT_IDEMPOTENCY_CONFLICT');
    return r;
  }
  const summary = paymentSummary(r);
  if (summary.paymentReport?.status === 'pending' && summary.paymentReport.kind !== 'cash')
    throw new PaymentError('PAYMENT_REPORT_PENDING');
  if ((r.partnerAudit?.filter(e => e.action === 'payment_reported').length ?? 0) >= 20)
    throw new PaymentError('PAYMENT_LIMIT_EXCEEDED');
  const instructions = publicPaymentSummary(r);
  const selected = input.kind === 'advance' ? instructions?.paymentInstructions : instructions?.fullPaymentInstructions;
  if (!selected || selected.amount !== input.amount || (input.kind === 'cash' && summary.advanceBalance > 0))
    throw new PaymentError('PAYMENT_REPORT_CHANGED');
  const now = new Date();
  const paymentReport = {
    ...input, reportedAt:now,
    rentalAmount:input.kind === 'advance' ? selected.amount : summary.rentalBalance,
    depositAmount:input.kind === 'advance' ? 0 : Math.max(0,summary.depositRequired-summary.depositHeld),
    rentalReceivedBefore:summary.rentalReceived, depositReceivedBefore:summary.depositReceived,
  };
  const updated = await ReservationV2Model.findOneAndUpdate({
    ...filter, _id:r._id, status:r.status,
    ...(r.status === 'pending' ? {expiresAt:{$gt:now}} : {}),
    ...(r.paymentRevision === undefined ? {paymentRevision:{$exists:false}} : {paymentRevision:r.paymentRevision}),
  }, {
    $set:{paymentReport}, $inc:{paymentRevision:1},
    $push:{partnerAudit:{action:'payment_reported',at:now,by:actor,
      operationId:input.operationId,amount:input.amount,method:input.kind === 'cash' ? 'cash' : 'bank_transfer',reference:input.kind}},
  }, {new:true,runValidators:true}).lean().exec();
  if (updated) {
    // Only the winning write sends an alert. Re-selecting the same pending cash
    // arrangement (even with a new operation ID) must not notify the owner again.
    const repeatedCash = input.kind === 'cash' && summary.paymentReport?.status === 'pending' &&
      summary.paymentReport.kind === 'cash' && summary.paymentReport.amount === input.amount;
    if (!repeatedCash) await notifyOwnerReservationPaymentReported(input.kind);
    return updated;
  }
  const current = await ReservationV2Model.findOne(filter).lean().exec();
  if (current?.paymentReport?.operationId === input.operationId) {
    if (current.paymentReport.amount !== input.amount || current.paymentReport.kind !== input.kind)
      throw new PaymentError('PAYMENT_IDEMPOTENCY_CONFLICT');
    return current;
  }
  throw new PaymentError('PAYMENT_CONFLICT');
}
