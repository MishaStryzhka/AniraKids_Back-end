export const PAYMENT_ENTRY_TYPES = ['advance_received', 'rental_received', 'deposit_received', 'rental_refunded', 'deposit_refunded', 'cancellation_fee', 'cancellation_fee_reversed'] as const;
export type PaymentEntryType = typeof PAYMENT_ENTRY_TYPES[number];
export interface PaymentEntry {
  operationId: string;
  type: PaymentEntryType;
  amount: number;
  method?: 'bank_transfer' | 'cash';
  reference?: string;
  note?: string;
  recordedAt: Date;
  recordedBy: string;
}
export type PaymentInput = Omit<PaymentEntry, 'recordedAt' | 'recordedBy'> & { expectedRevision: number };
export class PaymentError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
