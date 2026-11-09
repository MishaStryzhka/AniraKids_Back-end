export interface PaymentOptions {
  gateway: 'off' | 'revolut';
  qrEnabled: boolean;
  defaultMethod: 'online' | 'qr';
}
export const legacyRentalPayments: PaymentOptions = {gateway:'revolut',qrEnabled:true,defaultMethod:'qr'};
export const legacyFittingPayments: PaymentOptions = {gateway:'off',qrEnabled:true,defaultMethod:'qr'};
