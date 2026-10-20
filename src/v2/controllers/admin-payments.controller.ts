import {processAutomaticInvoice} from '../services/invoice-automation.service';
import { Types } from 'mongoose';
import type { HttpHandler } from '../types/http';
import { PaymentError } from '../services/payment.types';
import { parsePaymentInput, readPayments, recordPayment } from '../services/payment.service';

export const adminPayments: HttpHandler = async (request, response, next) => {
  try {
    const id = new Types.ObjectId(request.params!.reservationId);
    const payments = await readPayments(id);
    return response.status(200).json({ payments });
  } catch (error) {
    if (error instanceof PaymentError) return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return next(error);
  }
};
export const adminRecordPayment: HttpHandler = async (request, response, next) => {
  try {
    if (!request.authenticatedUserId) throw new PaymentError('ADMIN_UNAUTHORIZED', 401);
    const input = parsePaymentInput(request.body);
    const id = new Types.ObjectId(request.params!.reservationId);
    await recordPayment(id, input, request.authenticatedUserId.toHexString());
    const payments = await readPayments(id);
    const invoiceAutomation=['advance_received','rental_received'].includes(input.type)?await processAutomaticInvoice('reservation',request.params!.reservationId!):undefined;
    return response.status(200).json({ payments, ...(invoiceAutomation?{invoiceAutomation}:{}) });
  } catch (error) {
    if (error instanceof PaymentError) return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return next(error);
  }
};
