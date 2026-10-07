import { Types } from 'mongoose';

import {
  InventoryItemV2Model,
  ProductV2Model,
  VariantV2Model,
} from '../models';
import type {
  ProductV2,
} from '../types/domain';
import {
  generateProductSlug,
} from '../utils/slug';
import {
  CatalogueAdminError,
  type CatalogueActivationContext,
  type CatalogueInventoryCreateInput,
  type CatalogueInventoryUpdateInput,
  type CatalogueProductCreateInput,
  type CatalogueProductListOptions,
  type CatalogueProductUpdateInput,
  type CatalogueVariantCreateInput,
  type CatalogueVariantUpdateInput,
} from './catalogue-admin.types';

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface MongoDuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, number>;
}

const isMongoDuplicateKeyError = (
  error: unknown
): error is MongoDuplicateKeyError =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 11000;

const translateModelValidation = (error: unknown): never => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'ValidationError'
  ) {
    throw new CatalogueAdminError(
      'VALIDATION_ERROR',
      'Catalogue data failed validation'
    );
  }

  throw error;
};

const trimOrUndefined = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const assertActiveInventoryConditionAllowed = (
  condition: CatalogueInventoryCreateInput['condition'] | undefined
): void => {
  if (condition === 'damaged') {
    throw new CatalogueAdminError(
      'DAMAGED_ITEM_REQUIRES_MAINTENANCE',
      'Damaged inventory item must be moved to maintenance explicitly'
    );
  }
};

export const getProductActivationMissingRequirements = (
  product: Pick<
    ProductV2,
    | 'name'
    | 'slug'
    | 'description'
    | 'category'
    | 'gender'
    | 'color'
    | 'rentalEnabled'
    | 'rentalPrices'
    | 'photos'
    | 'status'
  >,
  context: CatalogueActivationContext
): string[] => {
  const missing: string[] = [];

  if (!product.name || product.name.trim().length < 2) {
    missing.push('name');
  }

  if (!product.slug || !slugPattern.test(product.slug)) {
    missing.push('slug');
  }

  if (!product.description || product.description.trim().length === 0) {
    missing.push('description');
  }

  if (!product.category) {
    missing.push('category');
  }

  if (!product.gender) {
    missing.push('gender');
  }

  if (!product.color || product.color.trim().length === 0) {
    missing.push('color');
  }

  if (product.rentalEnabled) {
    if (product.rentalPrices?.studio === undefined) {
      missing.push('rentalPrices.studio');
    }

    if (product.rentalPrices?.external === undefined) {
      missing.push('rentalPrices.external');
    }
  }

  if (!Array.isArray(product.photos) || product.photos.length === 0) {
    missing.push('photos');
  }

  if (context.activeVariantCount < 1) {
    missing.push('variants');
  }

  if (context.activeInventoryCount < 1) {
    missing.push('inventory');
  }

  if (product.status !== 'draft') {
    missing.push('status');
  }

  return missing;
};

export const applyProductInput = (
  product: any,
  input: CatalogueProductUpdateInput
): void => {
  const scalarFields = [
    'name',
    'slug',
    'description',
    'color',
    'occasion',
    'ageTags',
    'brand',
    'familyLookGroup',
    'rentalEnabled',
    'saleEnabled',
    'defaultDeposit',
  ] as const;

  for (const field of scalarFields) {
    if (input[field] !== undefined) {
      product.set(field, input[field]);
    }
  }

  for (const field of [
    'category',
    'gender',
    'defaultSalePrice',
  ] as const) {
    if (input[field] !== undefined) {
      product.set(
        field,
        input[field] === null ? undefined : input[field]
      );
    }
  }

  if (input.rentalPrices !== undefined) {
    const nextRentalPrices: {
      studio?: number;
      external?: number;
    } = {};

    const studio =
      input.rentalPrices.studio === undefined
        ? product.rentalPrices?.studio
        : input.rentalPrices.studio;
    const external =
      input.rentalPrices.external === undefined
        ? product.rentalPrices?.external
        : input.rentalPrices.external;

    if (studio !== undefined && studio !== null) {
      nextRentalPrices.studio = studio;
    }

    if (external !== undefined && external !== null) {
      nextRentalPrices.external = external;
    }

    product.set(
      'rentalPrices',
      Object.keys(nextRentalPrices).length === 0
        ? undefined
        : nextRentalPrices
    );
  }

  if (input.seo !== undefined) {
    for (const field of ['title', 'description'] as const) {
      if (input.seo[field] !== undefined) {
        product.set(`seo.${field}`, trimOrUndefined(input.seo[field]));
      }
    }
  }
};

const productCoreFields = [
  'name', 'slug', 'description', 'category', 'gender', 'color',
  'occasion', 'ageTags', 'brand', 'familyLookGroup',
  'rentalEnabled', 'saleEnabled', 'defaultSalePrice', 'defaultDeposit',
  'status',
] as const;

type ProductCandidate = ReturnType<typeof ProductV2Model.hydrate>;
type ProductOperation = 'patch' | 'activate' | 'archive';
type RawProduct = Record<string, any>;

// Value equality, including missing vs null, without query casting, defaults,
// BSON object-key order, or updatedAt acting as an accidental revision.
const productSnapshotFilter = (raw: RawProduct, operation: ProductOperation) => {
  const comparisons: Record<string, unknown>[] = [];
  const compare = (path: string, value: unknown): void => {
    comparisons.push(value === undefined
      ? { $eq: [{ $type: `$${path}` }, 'missing'] }
      : { $and: [
          { $ne: [{ $type: `$${path}` }, 'missing'] },
          { $eq: [`$${path}`, { $literal: Array.isArray(value) ? [...value] : value }] },
        ] });
  };

  for (const field of productCoreFields) compare(field, raw[field]);
  for (const [parent, leaves] of [
    ['rentalPrices', ['studio', 'external']],
    ['seo', ['title', 'description', 'noIndex']],
  ] as const) {
    const value = raw[parent];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      comparisons.push({ $eq: [{ $type: `$${parent}` }, 'object'] });
      for (const leaf of leaves) compare(`${parent}.${leaf}`, value[leaf]);
    } else {
      compare(parent, value);
    }
  }

  if (operation === 'activate') {
    // Photos stay outside the Core snapshot. Only evaluated presence participates
    // in activation's CAS and rejection freshness; composition may still change.
    comparisons.push({ $eq: [
      { $gt: [{ $size: { $cond: [{ $isArray: '$photos' }, '$photos', []] } }, 0] },
      { $literal: Array.isArray(raw.photos) && raw.photos.length > 0 },
    ] });
  }
  return { _id: raw._id, $expr: { $and: comparisons } };
};

const productOwnedUpdate = (
  raw: RawProduct,
  candidate: ProductCandidate,
  paths: string[]
) => {
  const $set: Record<string, unknown> = { updatedAt: new Date() };
  const $unset: Record<string, ''> = {};
  for (const path of paths) {
    const value = candidate.get(path);
    if (value === undefined) $unset[path] = '';
    else $set[path] = value?.toObject ? value.toObject() : value;
  }

  // Mongo cannot set a dotted leaf below null. Materialize only owned leaves;
  // never copy hydration's noIndex default into a Core PATCH. The CAS protects
  // this raw null parent, so no concurrently added sibling can be lost.
  if (raw.seo === null) {
    const ownedSeo: Record<string, unknown> = {};
    for (const path of paths.filter(path => path.startsWith('seo.'))) {
      if (path in $set) ownedSeo[path.slice(4)] = $set[path];
      delete $set[path];
      delete $unset[path];
    }
    if (Object.keys(ownedSeo).length) $set.seo = ownedSeo;
  }
  return { $set, ...(Object.keys($unset).length ? { $unset } : {}) };
};

const coordinateProductMutation = async (
  productId: Types.ObjectId,
  operation: ProductOperation,
  prepare: (candidate: ProductCandidate, raw: RawProduct) => Promise<string[] | null>
) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const raw = await ProductV2Model.findById(productId)
      .read('primary').lean().exec();
    if (!raw) {
      throw new CatalogueAdminError('PRODUCT_NOT_FOUND', 'Product not found');
    }
    const filter = productSnapshotFilter(raw, operation);
    const candidate = ProductV2Model.hydrate(raw);
    let paths: string[] | null;
    try {
      paths = await prepare(candidate, raw);
      if (paths !== null) await candidate.validate();
    } catch (error) {
      // Only Product-dependent business/validation errors need freshness.
      // Infrastructure failures are never turned into business retries.
      if (!(error instanceof CatalogueAdminError) &&
          !(error instanceof Error && error.name === 'ValidationError')) {
        throw error;
      }
      const current = await ProductV2Model.collection.findOne(filter, {
        readPreference: 'primary', projection: { _id: 1 },
      });
      if (!current) continue;
      return translateModelValidation(error);
    }

    if (paths === null) {
      const current = await ProductV2Model.collection.findOne(filter, {
        readPreference: 'primary',
      });
      if (!current) continue;
      return ProductV2Model.hydrate(current);
    }

    try {
      // Native collection preserves the raw $expr literals without Mongoose
      // query casting. Full document validation ran above; returnDocument:after
      // is the driver's equivalent of Mongoose new:true. No graph transaction.
      const result = await ProductV2Model.collection.findOneAndUpdate(
        { ...filter, ...(operation === 'activate' ? { status: 'draft' } : {}) },
        productOwnedUpdate(raw, candidate, paths),
        { returnDocument: 'after', upsert: false, writeConcern: { w: 'majority' } }
      );
      if (result.value) return ProductV2Model.hydrate(result.value);
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new CatalogueAdminError('SLUG_ALREADY_EXISTS', 'Product slug already exists');
      }
      // Includes ambiguous network/write-concern errors: never replay them here.
      throw error;
    }
  }
  throw new CatalogueAdminError(
    'PRODUCT_STATE_CONFLICT',
    'Product changed during the operation. Refresh and try again.'
  );
};

export class CatalogueAdminService {
  async listProducts(options: CatalogueProductListOptions) {
    const filter: Record<string, unknown> = {};

    if (options.status !== undefined) {
      filter.status = options.status;
    }

    if (options.category !== undefined) {
      filter.category = options.category;
    }

    if (options.gender !== undefined) {
      filter.gender = options.gender;
    }

    if (options.rentalEnabled !== undefined) {
      filter.rentalEnabled = options.rentalEnabled;
    }

    const skip = (options.page - 1) * options.limit;

    const [items, total] = await Promise.all([
      ProductV2Model.find(filter)
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .lean()
        .exec(),
      ProductV2Model.countDocuments(filter).exec(),
    ]);

    return {
      items,
      pagination: {
        page: options.page,
        limit: options.limit,
        total,
        pages: total === 0 ? 0 : Math.ceil(total / options.limit),
      },
    };
  }

  async getProductDetail(productId: Types.ObjectId) {
    const product = await ProductV2Model.findById(productId)
      .lean()
      .exec();

    if (!product) {
      throw new CatalogueAdminError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    const variants = await VariantV2Model.find({ productId })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean()
      .exec();

    const variantIds = variants.map(variant => variant._id);

    const inventory = variantIds.length
      ? await InventoryItemV2Model.find({
          variantId: {
            $in: variantIds,
          },
        })
          .select(
            '_id variantId internalCode status condition notes acquiredAt retiredAt createdAt updatedAt'
          )
          .sort({ createdAt: 1 })
          .lean()
          .exec()
      : [];

    const inventoryByVariant = new Map<string, typeof inventory>();

    for (const item of inventory) {
      const key = item.variantId.toString();
      const current = inventoryByVariant.get(key) ?? [];
      current.push(item);
      inventoryByVariant.set(key, current);
    }

    return {
      product,
      variants: variants.map(variant => ({
        variant,
        inventory:
          inventoryByVariant.get(variant._id.toString()) ?? [],
      })),
    };
  }

  async createProduct(input: CatalogueProductCreateInput) {
    const slug = input.slug ?? generateProductSlug(input.name);

    if (!slug || !slugPattern.test(slug)) {
      throw new CatalogueAdminError(
        'VALIDATION_ERROR',
        'Unable to generate a valid product slug',
        ['slug']
      );
    }

    const duplicate = await ProductV2Model.exists({ slug }).exec();

    if (duplicate) {
      throw new CatalogueAdminError(
        'SLUG_ALREADY_EXISTS',
        'Product slug already exists'
      );
    }

    const payload = {
      ...input,
      slug,
      status: 'draft' as const,
      photos: [],
      occasion: input.occasion ?? [],
      ageTags: input.ageTags ?? [],
      rentalEnabled: input.rentalEnabled ?? false,
      saleEnabled: input.saleEnabled ?? false,
      defaultDeposit: input.defaultDeposit ?? 0,
      seo: {
        title: trimOrUndefined(input.seo?.title),
        description: trimOrUndefined(input.seo?.description),
        noIndex: true,
      },
    };

    try {
      return await ProductV2Model.create(payload);
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new CatalogueAdminError(
          'SLUG_ALREADY_EXISTS',
          'Product slug already exists'
        );
      }

      return translateModelValidation(error);
    }
  }

  async updateProduct(
    productId: Types.ObjectId,
    input: CatalogueProductUpdateInput
  ) {
    return coordinateProductMutation(productId, 'patch', async product => {
      if (input.slug !== undefined && input.slug !== product.slug) {
        const duplicate = await ProductV2Model.exists({
          slug: input.slug, _id: { $ne: productId },
        }).read('primary').exec();
        if (duplicate) {
          throw new CatalogueAdminError('SLUG_ALREADY_EXISTS', 'Product slug already exists');
        }
      }
      // Reapply the original partial input on every fresh candidate.
      applyProductInput(product, input);
      const paths: string[] = productCoreFields.filter(field =>
        field !== 'status' && input[field] !== undefined
      );
      if (input.rentalPrices !== undefined) paths.push('rentalPrices');
      for (const leaf of ['title', 'description'] as const) {
        if (input.seo?.[leaf] !== undefined) paths.push(`seo.${leaf}`);
      }
      return paths;
    });
  }

  async createVariant(
    productId: Types.ObjectId,
    input: CatalogueVariantCreateInput
  ) {
    const productExists = await ProductV2Model.exists({
      _id: productId,
    }).exec();

    if (!productExists) {
      throw new CatalogueAdminError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    try {
      return await VariantV2Model.create({
        productId,
        ...input,
        status: input.status ?? 'active',
        sortOrder: input.sortOrder ?? 0,
      });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        if (error.keyPattern?.sku === 1) {
          throw new CatalogueAdminError(
            'SKU_ALREADY_EXISTS',
            'Variant SKU already exists'
          );
        }

        throw new CatalogueAdminError(
          'VARIANT_SIZE_ALREADY_EXISTS',
          'Product variant size already exists'
        );
      }

      return translateModelValidation(error);
    }
  }

  async updateVariant(
    variantId: Types.ObjectId,
    input: CatalogueVariantUpdateInput
  ) {
    const variant: any = await VariantV2Model.findById(variantId).exec();

    if (!variant) {
      throw new CatalogueAdminError(
        'VARIANT_NOT_FOUND',
        'Variant not found'
      );
    }

    for (const [field, value] of Object.entries(input)) {
      if (value !== undefined) {
        variant.set(field, value);
      }
    }

    try {
      return await variant.save();
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        if (error.keyPattern?.sku === 1) {
          throw new CatalogueAdminError(
            'SKU_ALREADY_EXISTS',
            'Variant SKU already exists'
          );
        }

        throw new CatalogueAdminError(
          'VARIANT_SIZE_ALREADY_EXISTS',
          'Product variant size already exists'
        );
      }

      return translateModelValidation(error);
    }
  }

  async createInventoryItem(
    variantId: Types.ObjectId,
    input: CatalogueInventoryCreateInput
  ) {
    const variantExists = await VariantV2Model.exists({
      _id: variantId,
    }).exec();

    if (!variantExists) {
      throw new CatalogueAdminError(
        'VARIANT_NOT_FOUND',
        'Variant not found'
      );
    }

    assertActiveInventoryConditionAllowed(input.condition);

    try {
      return await InventoryItemV2Model.create({
        variantId,
        internalCode: input.internalCode,
        condition: input.condition,
        notes: input.notes,
        acquiredAt: input.acquiredAt,
        status: 'active',
      });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new CatalogueAdminError(
          'INVENTORY_CODE_ALREADY_EXISTS',
          'Inventory internal code already exists'
        );
      }

      return translateModelValidation(error);
    }
  }

  async updateInventoryItem(
    inventoryItemId: Types.ObjectId,
    input: CatalogueInventoryUpdateInput
  ) {
    const item: any = await InventoryItemV2Model.findById(
      inventoryItemId
    ).exec();

    if (!item) {
      throw new CatalogueAdminError(
        'INVENTORY_ITEM_NOT_FOUND',
        'Inventory item not found'
      );
    }

    if (item.status === 'active') {
      assertActiveInventoryConditionAllowed(input.condition);
    }

    if (input.condition !== undefined) {
      item.condition = input.condition;
    }

    if (input.notes !== undefined) {
      item.notes = input.notes;
    }

    if (input.acquiredAt !== undefined) {
      item.acquiredAt = input.acquiredAt;
    }

    try {
      return await item.save();
    } catch (error) {
      return translateModelValidation(error);
    }
  }

  async activateProduct(productId: Types.ObjectId) {
    return coordinateProductMutation(productId, 'activate', async (product, raw) => {
      // These graph reads are repeated on retry, but are not an atomic graph
      // snapshot and do not reserve Inventory or future rental availability.
      const activeVariants = await VariantV2Model.find({ productId, status: 'active' })
        .read('primary').select('_id').lean().exec();
      const activeInventoryCount = activeVariants.length
        ? await InventoryItemV2Model.countDocuments({
            variantId: { $in: activeVariants.map(variant => variant._id) },
            status: 'active',
          }).read('primary').exec()
        : 0;
      const missing = getProductActivationMissingRequirements({
        ...product.toObject(), status: raw.status,
      }, {
        activeVariantCount: activeVariants.length, activeInventoryCount,
      });
      if (missing.length) {
        throw new CatalogueAdminError(
          'PRODUCT_NOT_READY', 'Product is not ready for activation', missing
        );
      }
      product.set('status', 'active');
      product.set('seo.noIndex', false);
      return ['status', 'seo.noIndex'];
    });
  }

  async archiveProduct(productId: Types.ObjectId) {
    return coordinateProductMutation(productId, 'archive', async product => {
      if (product.status === 'active') {
        throw new CatalogueAdminError(
          'PRODUCT_ARCHIVE_REQUIRES_RESERVATION_REVIEW',
          'Active product archive requires reservation review'
        );
      }
      if (product.status === 'archived') return null;
      product.set('status', 'archived');
      product.set('seo.noIndex', true);
      return ['status', 'seo.noIndex'];
    });
  }
}

export const catalogueAdminService = new CatalogueAdminService();
