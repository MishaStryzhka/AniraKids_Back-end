import { AvailabilityBlockV2Model, InventoryItemV2Model, ProductV2Model, VariantV2Model } from '../models';
import { parseDateOnly, formatDateOnly } from '../utils/date-only';
export async function calendarBlocks(from: string, to: string) {
  const records = await AvailabilityBlockV2Model.find({ startDate: { $lte: parseDateOnly(to) }, endDate: { $gte: parseDateOnly(from) } }).sort({ startDate: 1, _id: 1 }).limit(1001).lean().exec();
  const inventory = await InventoryItemV2Model.find({ _id: { $in: records.map(r => r.inventoryItemId) } }).select('internalCode variantId').lean().exec();
  const variants = await VariantV2Model.find({ _id: { $in: inventory.map(i => i.variantId) } }).select('productId').lean().exec();
  const productIds = new Map(variants.map(v => [String(v._id), String(v.productId)]));
  const products = await ProductV2Model.find({ _id: { $in: variants.map(v => v.productId) } }).select('name').lean().exec();
  const pieces = new Map(inventory.map(i => [String(i._id), i]));
  const names = new Map(products.map(p => [String(p._id), p.name]));
  return { blocks: records.slice(0, 1000).map(r => { const piece = pieces.get(String(r.inventoryItemId)); const productId = productIds.get(String(piece?.variantId)); return {
    id: String(r._id), productId: productId || null, productName: names.get(String(productId)) || 'Produkt není dostupný',
    internalCode: piece?.internalCode || String(r.inventoryItemId), reason: r.reason, startDate: formatDateOnly(r.startDate), endDate: formatDateOnly(r.endDate),
  }; }), blocksTruncated: records.length > 1000 };
}
