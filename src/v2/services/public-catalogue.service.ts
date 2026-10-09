import { Types, PipelineStage } from 'mongoose';
import { ProductV2Model, VariantV2Model } from '../models';
import type {
  ProductV2,
  Variant,
  RentalMode,
  ProductCategory,
} from '../types/domain';
import { availabilityService } from './availability.service';
import {
  addCalendarDays,
  getBusinessDateOnly,
  parseDateOnly,
} from '../utils/date-only';
import { CLEANING_BUFFER_DAYS } from '../utils/availability';
import {
  calculateReservationTotals,
  PricingError,
  resolveRentalPricing,
} from '../utils/pricing';

export class PublicCatalogueError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
    this.name = 'PublicCatalogueError';
  }
}

export interface PublicCatalogueQuery {
  category?: ProductCategory;
  q?: string;
  sort: 'name' | 'newest' | 'priceAsc' | 'priceDesc';
  gender?: ProductV2['gender'] | 'children';
  color?: string;
  size?: string;
  familyLook?: 'true';
  rentalMode?: RentalMode;
  minPrice?: number;
  maxPrice?: number;
  page: number;
  limit: number;
}

export interface PublicAvailabilityQuery {
  variantId: string;
  rentalMode: RentalMode;
  startDate: string;
  endDate: string;
}

const productProjection =
  '_id slug name description category color photos rentalEnabled rentalPrices defaultDeposit';
const publicProduct = (product: ProductV2 & { _id: Types.ObjectId }) => ({
  id: product._id.toHexString(),
  slug: product.slug,
  name: product.name,
  ...(product.category ? { category: product.category } : {}),
  ...(product.color ? { color: product.color } : {}),
  // Explicit projection: Cloudinary public IDs and administrative fields stay private.
  photos: product.photos.map(photo => ({
    url: photo.url,
    ...(photo.alt ? { alt: photo.alt } : {}),
  })),
});

const pricing = (product: ProductV2, variant: Variant, mode: RentalMode) => {
  const resolved = resolveRentalPricing(product, variant, mode);
  const totals = calculateReservationTotals([resolved]);
  return { ...resolved, totalDue: totals.totalDue };
};

const optionalPricing = (
  product: ProductV2,
  variant: Variant,
  mode: RentalMode
) => {
  try {
    return pricing(product, variant, mode);
  } catch (error) {
    if (error instanceof PricingError) return null;
    throw error;
  }
};

export class PublicCatalogueService {
  async list(query: PublicCatalogueQuery) {
    const escaped = query.q?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      status: 'active',
      rentalEnabled: true,
      ...(query.category ? { category: query.category } : {}),
      ...(escaped ? { name: { $regex: escaped, $options: 'i' } } : {}),
    };
    const mode = query.rentalMode || 'studio';
    const productFilters: Record<string, unknown> = {
      ...(query.gender ? { gender: query.gender === 'children' ? { $in: ['girls', 'boys'] } : query.gender } : {}),
      ...(query.color ? { color: query.color } : {}),
      ...(query.familyLook ? { familyLookGroup: { $type: 'string', $nin: ['', null] } } : {}),
    };
    // Size and price must match the same active variant, including its price override.
    const variantConditions: unknown[] = [
      ...(query.size ? [{ $eq: ['$$variant.size', query.size] }] : []),
      ...(query.minPrice !== undefined ? [{ $gte: ['$$variant.price', query.minPrice] }] : []),
      ...(query.maxPrice !== undefined ? [{ $and: [{ $ne: ['$$variant.price', null] }, { $lte: ['$$variant.price', query.maxPrice] }] }] : []),
    ];
    const matched: PipelineStage.FacetPipelineStage[] = [
      { $match: productFilters },
      { $set: { matchedVariants: { $filter: { input: '$variants', as: 'variant', cond: variantConditions.length ? { $and: variantConditions } : true } } } },
      ...(variantConditions.length ? [{ $match: { 'matchedVariants.0': { $exists: true } } }] : []),
      { $set: { rentalPriceFrom: { $min: '$matchedVariants.price' } } },
      { $set: { missingPrice: { $cond: [{ $eq: ['$rentalPriceFrom', null] }, 1, 0] } } },
    ];
    const sort: Record<string, 1 | -1> = query.sort === 'newest' ? { createdAt: -1, _id: -1 } :
      query.sort === 'priceAsc' ? { missingPrice: 1, rentalPriceFrom: 1, _id: 1 } :
      query.sort === 'priceDesc' ? { missingPrice: 1, rentalPriceFrom: -1, _id: 1 } : { name: 1, _id: 1 };
    const pipeline: PipelineStage[] = [
      { $match: filter },
      { $lookup: { from: VariantV2Model.collection.name, let: { productId: '$_id', basePrice: '$rentalPrices.' + mode }, pipeline: [
        { $match: { $expr: { $and: [{ $eq: ['$productId', '$$productId'] }, { $eq: ['$status', 'active'] }] } } },
        { $project: { _id: 0, size: 1, price: { $ifNull: ['$rentalPriceOverrides.' + mode, { $ifNull: ['$$basePrice', null] }] } } },
      ], as: 'variants' } },
      { $facet: {
        items: [...matched, { $sort: sort }, { $skip: (query.page - 1) * query.limit }, { $limit: query.limit }],
        count: [...matched, { $count: 'total' }],
        colors: [{ $match: { color: { $type: 'string', $nin: ['', null] } } }, { $group: { _id: '$color' } }, { $sort: { _id: 1 } }],
        sizes: [{ $unwind: '$variants' }, { $group: { _id: '$variants.size' } }, { $sort: { _id: 1 } }],
      } },
    ];
    const [result] = await ProductV2Model.aggregate(pipeline).exec();
    const total = result.count[0]?.total || 0;
    return {
      items: result.items.map((product: ProductV2 & { _id: Types.ObjectId; rentalPriceFrom?: number }) => ({
        ...publicProduct(product),
        ...(typeof product.rentalPriceFrom === 'number' ? { rentalPriceFrom: product.rentalPriceFrom } : {}),
      })),
      facets: { colors: result.colors.map((item: { _id: string }) => item._id), sizes: result.sizes.map((item: { _id: string }) => item._id) },
      page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit),
    };
  }

  async detail(slug: string) {
    const product = await ProductV2Model.findOne({
      slug,
      status: 'active',
      rentalEnabled: true,
    })
      .select(productProjection)
      .exec();
    if (!product) throw new PublicCatalogueError(404, 'PRODUCT_NOT_FOUND');
    const variants = await VariantV2Model.find({
      productId: product._id,
      status: 'active',
    })
      .select('_id size rentalPriceOverrides depositOverride sortOrder')
      .sort({ sortOrder: 1, size: 1, _id: 1 })
      .exec();
    return {
      product: {
        ...publicProduct(product),
        ...(product.description ? { description: product.description } : {}),
        variants: variants.map(variant => ({
          id: variant._id.toHexString(),
          size: variant.size,
          pricing: {
            studio: optionalPricing(product, variant, 'studio'),
            external: optionalPricing(product, variant, 'external'),
          },
        })),
      },
    };
  }

  async availability(
    productId: string,
    query: PublicAvailabilityQuery,
    now = new Date()
  ) {
    let start: Date, end: Date;
    try {
      start = parseDateOnly(query.startDate);
      end = parseDateOnly(query.endDate);
      if (end < start) throw new Error('Invalid range');
    } catch {
      throw new PublicCatalogueError(400, 'INVALID_DATE');
    }
    if (query.startDate < getBusinessDateOnly(now))
      throw new PublicCatalogueError(400, 'PAST_START_DATE');
    const product = await ProductV2Model.findOne({
      _id: productId,
      status: 'active',
      rentalEnabled: true,
    })
      .select(productProjection)
      .exec();
    if (!product) throw new PublicCatalogueError(404, 'PRODUCT_NOT_FOUND');
    const variant = await VariantV2Model.findById(query.variantId).exec();
    if (!variant) throw new PublicCatalogueError(404, 'VARIANT_NOT_FOUND');
    if (!variant.productId.equals(product._id))
      throw new PublicCatalogueError(400, 'VARIANT_PRODUCT_MISMATCH');
    if (variant.status !== 'active')
      throw new PublicCatalogueError(409, 'VARIANT_NOT_ACTIVE');
    const quote = optionalPricing(product, variant, query.rentalMode);
    if (!quote) throw new PublicCatalogueError(409, 'RENTAL_MODE_UNAVAILABLE');
    // The create transaction occupies the rental through its cleaning buffer.
    // A quote must test the same range, including manual blocks on that last day.
    const result = await availabilityService.getVariantAvailability(
      variant._id,
      start,
      addCalendarDays(end, CLEANING_BUFFER_DAYS),
      { now }
    );
    return {
      availability: {
        productId: product._id.toHexString(),
        variantId: variant._id.toHexString(),
        rentalMode: query.rentalMode,
        startDate: query.startDate,
        endDate: query.endDate,
        available: result.available,
        checkedAt: now.toISOString(),
        pricing: quote,
      },
    };
  }
}

export const publicCatalogueService = new PublicCatalogueService();
