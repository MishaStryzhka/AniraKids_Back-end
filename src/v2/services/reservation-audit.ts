import type {Reservation} from '../types/domain';

export function reservationHistory(source: Pick<Reservation, 'partnerAudit'|'paymentEntries'>) {
  const events = [...(source.partnerAudit || [])];
  const recordedPayments = new Set(events.map(event => event.operationId).filter(Boolean));
  for (const entry of source.paymentEntries || []) {
    if (!recordedPayments.has(entry.operationId)) events.push({
      action:entry.type, at:entry.recordedAt, by:entry.recordedBy,
      operationId:entry.operationId, amount:entry.amount, method:entry.method,
    });
  }
  return events.sort((a,b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}
