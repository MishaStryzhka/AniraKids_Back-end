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
  const fittingReward = (f: any) => {
    const r = credited.get(String(f._id));
    const studio = Boolean(r && f.partner?.partnerId === 'blaze' &&
      r.partner?.partnerId === f.partner.partnerId && r.rentalMode === 'studio' &&
      ['confirmed', 'prepared', 'rented', 'returned'].includes(r.status));
    return { amount: f.status === 'completed' && f.paymentStatus === 'paid' && !studio ? 200 : 0,
      reason: studio ? 'studio_rental' : 'fitting' };
  };
  for (const r of reservations) {
    const fitting = fittings.find(f => String(f._id) === r.fittingCreditId);
    const source = r.partner?.source || fitting?.partner?.source || 'anirak';
    const summary = paymentSummary(r);
    const fixedReward = source !== 'partner';
    const fittingDeduction = fixedReward && fitting &&
      fitting.partner?.partnerId === r.partner?.partnerId ? fittingReward(fitting).amount : 0;
    const rewardAmount = fixedReward ? 200 :
      Math.round(((r.subtotal + (r.fittingDiscount?.amount || 0)) * 100) / 2) / 100;
    const share = Math.max(0, rewardAmount - fittingDeduction);
    const net = Math.max(0, Math.min(r.subtotal + (r.fittingDiscount?.amount || 0), summary.rentalNet + (r.fittingDiscount?.amount || 0)));
    const accrued =
      r.status === 'returned'
        ? Math.round(
            Math.min(share, net * (fixedReward ? 1 : 0.5)) * 100
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
      rentalPrice: r.subtotal + (r.fittingDiscount?.amount || 0),
      rewardBasis: net,
      rewardRate: source === 'partner' ? 50 : 0,
      rewardType: fixedReward ? 'fixed' : 'percentage',
      rewardAmount,
      fittingDeduction,
      fittingNumber: fittingDeduction > 0 ? fitting.number : null,
      expected: share,
      collected: cash,
      status: r.status,
    });
  }
  for (const f of fittings) {
    const { amount, reason } = fittingReward(f);
    earned += amount;
    lines.push({
      kind: 'fitting',
      number: f.number,
      source: f.partner?.source || 'anirak',
      amount,
      status: f.status,
      reason,
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
