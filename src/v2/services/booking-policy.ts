// Public company payment details supplied and approved by the owner. No credentials.
export const BOOKING_POLICY = {
  policyVersion: 1,
  advanceAmount: 200,
  currency: 'CZK',
  confirmation: 'manual_after_payment',
  paymentMethod: 'bank_transfer',
  company: {
    name: 'GlamGarb Rentals s.r.o.', ico: '19970561',
    address: 'Bílkova 855/19, Staré Město, 110 00 Praha 1',
    register: 'Městský soud v Praze, oddíl C, vložka 394851', vatPayer: false,
  },
  bank: {
    iban: 'CZ0708000000006644781399', accountNumber: '6644781399/0800',
    bic: 'GIBACZPX', beneficiary: 'GlamGarb Rentals s.r.o.',
  },
  cancellation: { feeAmount: 200, automatic: false },
} as const;

export const isValidCzechIban = (value: string): boolean => {
  if (!/^CZ\d{22}$/.test(value)) return false;
  let remainder = 0;
  const numeric = (value.slice(4) + value.slice(0, 4)).replace(/[A-Z]/g, c => String(c.charCodeAt(0) - 55));
  for (const char of numeric) remainder = (remainder * 10 + Number(char)) % 97;
  return remainder === 1;
};
