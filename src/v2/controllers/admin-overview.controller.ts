import { ReservationV2Model, InventoryItemV2Model, ProductV2Model } from '../models';
import { getBusinessDateOnly, parseDateOnly, formatDateOnly } from '../utils/date-only';
import type { HttpHandler } from '../types/http';
import { FittingModel } from '../models/fitting.model';
const row = (r: any) => ({ id: String(r._id), number: r.reservationNumber, name: [r.customerSnapshot?.firstName, r.customerSnapshot?.lastName].filter(Boolean).join(' '), startDate: formatDateOnly(r.startDate), endDate: formatDateOnly(r.endDate), status: r.status, product: r.items?.map((i: any) => i.productNameSnapshot).join(', ') || '' });
async function group(filter: any) {
  const [total, items] = await Promise.all([ReservationV2Model.countDocuments(filter).exec(), ReservationV2Model.find(filter).sort({ startDate: 1, _id: 1 }).limit(10).lean().exec()]);
  return { total, items: items.map(row) };
}
async function fittingGroup(filter:any){
  const [total,items]=await Promise.all([FittingModel.countDocuments(filter).exec(),FittingModel.find(filter).select('number customer.name product.name date time status').sort({date:1,time:1,_id:1}).limit(10).lean().exec()]);
  return {total,items:items.map((f:any)=>({id:String(f._id),number:f.number,name:f.customer?.name||'',product:f.product?.name||'',date:f.date,time:f.time,status:f.status}))};
}
export const adminOverview: HttpHandler = async (request, response, next) => {
  try {
    const now = new Date(), today = getBusinessDateOnly(now), date = parseDateOnly(today);
    const canReadFittings=request.adminOwner||request.adminPermissions?.includes('fittings');
    const activeFittings={$or:[{status:{$in:['review','confirmed']}},{status:'pending',expiresAt:{$gt:now}}]};
    const [pickups, returns, pending, unpaid, overdue, maintenance, drafts, deposits, fittings] = await Promise.all([
      group({ status: { $in: ['confirmed', 'prepared'] }, startDate: { $lte: date } }),
      group({ status: 'rented', endDate: { $lte: date } }),
      group({ status: 'pending', expiresAt: { $gt: now } }),
      ReservationV2Model.countDocuments({ status: { $in: ['confirmed', 'prepared', 'rented'] }, paymentStatus: 'unpaid' }).exec(),
      ReservationV2Model.countDocuments({ status: 'rented', endDate: { $lt: date } }).exec(),
      InventoryItemV2Model.countDocuments({ status: 'maintenance' }).exec(),
      ProductV2Model.countDocuments({ status: 'draft' }).exec(),
      ReservationV2Model.aggregate([
        { $match: { status: { $in: ['returned', 'cancelled'] } } },
        { $addFields: { held: { $reduce: { input: { $ifNull: ['$paymentEntries', []] }, initialValue: 0, in: { $add: ['$$value', { $switch: { branches: [{ case: { $eq: ['$$this.type', 'deposit_received'] }, then: '$$this.amount' }, { case: { $eq: ['$$this.type', 'deposit_refunded'] }, then: { $multiply: ['$$this.amount', -1] } }], default: 0 } }] } } } } },
        { $match: { held: { $gt: 0 } } }, { $sort: { endDate: 1, _id: 1 } },
        { $facet: { total: [{ $count: 'value' }], items: [{ $limit: 10 }] } },
      ]).exec(),
      canReadFittings?Promise.all([
        fittingGroup({status:'review'}),
        fittingGroup({status:'pending',expiresAt:{$gt:now}}),
        fittingGroup({date:today,...activeFittings}),
      ]).then(([review,pending,today])=>({review,pending,today})):Promise.resolve(null),
    ]);
    response.setHeader?.('Cache-Control', 'private, no-store');
    return response.status(200).json({ today, loadedAt: now.toISOString(), pickups, returns, pending, unpaid, overdue, maintenance, drafts, fittings,
      deposits: { total: deposits[0]?.total[0]?.value || 0, items: (deposits[0]?.items || []).map(row) } });
  } catch (error) { return next(error); }
};
