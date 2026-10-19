import { PartnerModel } from '../models/partner.model';
import { ReservationV2Model } from '../models/reservation-v2.model';
import { FittingModel } from '../models/fitting.model';
import { paymentSummary } from './payment.service';

// Preserve the agreed partner share basis for both historical credits and new discounts.
export function calculatePartnerBalance(
  reservations: any[],
  fittings: any[],
  settlements: any[] = []
) {
  const lines: any[] = [];
  let earned = 0,
    collected = 0,
    expected = 0;
  const credited = new Map(
    reservations.filter(r => r.fittingCreditId).map(r => [r.fittingCreditId, r])
  );
  for (const r of reservations) {
    const fitting = fittings.find(f => String(f._id) === r.fittingCreditId);
    const source = r.partner?.source || fitting?.partner?.source || 'anirak';
    const summary = paymentSummary(r);
    const share =
      source === 'partner' ? Math.round(((r.subtotal + (r.fittingDiscount?.amount || 0)) * 100) / 2) / 100 : 0;
    const net = Math.max(0, Math.min(r.subtotal + (r.fittingDiscount?.amount || 0), summary.rentalNet + (r.fittingDiscount?.amount || 0)));
    const accrued =
      r.status === 'returned'
        ? Math.round(
            Math.min(share, net * (source === 'partner' ? 0.5 : 0)) * 100
          ) / 100
        : 0;
    const cash = (r.paymentEntries || [])
      .filter(
        (e: any) =>
          String(e.recordedBy).startsWith('partner:') && e.method === 'cash'
      )
      .reduce(
        (n: number, e: any) =>
          n +
          (['rental_received', 'advance_received', 'deposit_received'].includes(
            e.type
          )
            ? e.amount
            : ['rental_refunded', 'deposit_refunded'].includes(e.type)
              ? -e.amount
              : 0),
        0
      );
    earned += accrued;
    collected += cash;
    if (!['cancelled', 'returned'].includes(r.status)) expected += share;
    lines.push({
      kind: 'rental',
      number: r.reservationNumber,
      source,
      amount: accrued,
      expected: share,
      collected: cash,
      status: r.status,
    });
  }
  for (const f of fittings) {
    const r = credited.get(String(f._id));
    // A credited partner rental already includes the fitting in the 50% share.
    const absorbed =
      r && (r.partner?.source || f.partner?.source) === 'partner';
    const studio =
      f.studioBooked === true ||
      (r &&
        r.rentalMode === 'studio' &&
        ['confirmed', 'prepared', 'rented', 'returned'].includes(r.status));
    const amount =
      f.status === 'completed' &&
      f.paymentStatus === 'paid' &&
      !absorbed &&
      !studio
        ? 200
        : 0;
    earned += amount;
    lines.push({
      kind: 'fitting',
      number: f.number,
      amount,
      status: f.status,
      reason: absorbed
        ? 'included_in_share'
        : studio
          ? 'studio_booked'
          : 'fitting',
    });
  }
  const transferred = settlements.reduce(
    (n: number, s: any) =>
      n + (s.direction === 'to_partner' ? s.amount : -s.amount),
    0
  );
  return {
    earned,
    expected,
    collected,
    transferred,
    balance: Math.round((earned - collected - transferred) * 100) / 100,
    lines,
  };
}
export async function partnerBalance(partnerId: string) {
  const partner = (await PartnerModel.findById(partnerId).lean().exec()) as any;
  const [reservations, fittings] = await Promise.all([
    ReservationV2Model.find({ 'partner.partnerId': partnerId }).lean().exec(),
    FittingModel.find({ 'partner.partnerId': partnerId }).lean().exec(),
  ]);
  return {
    ...calculatePartnerBalance(
      reservations,
      fittings,
      partner?.settlements || []
    ),
    settlements: partner?.settlements || [],
    revision: partner?.revision || 0,
  };
}
