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

const applyProductInput = (
  product: any,
  input: CatalogueProductUpdateInput
): void => {
  const scalarFields = [
    'name',
    'slug',
    'description',
    'category',
    'gender',
    'color',
    'occasion',
    'ageTags',
    'brand',
    'familyLookGroup',
    'rentalEnabled',
    'saleEnabled',
    'defaultSalePrice',
    'defaultDeposit',
  ] as const;

  for (const field of scalarFields) {
    if (input[field] !== undefined) {
      product.set(field, input[field]);
    }
  }

  if (input.rentalPrices !== undefined) {
    product.set('rentalPrices', {
      studio:
        input.rentalPrices.studio ??
        product.rentalPrices?.studio,
      external:
        input.rentalPrices.external ??
        product.rentalPrices?.external,
    });
  }

  if (input.seo !== undefined) {
    product.set('seo', {
      title:
        input.seo.title !== undefined
          ? trimOrUndefined(input.seo.title)
          : product.seo?.title,
      description:
        input.seo.description !== undefined
          ? trimOrUndefined(input.seo.description)
          : product.seo?.description,
      noIndex: product.seo?.noIndex ?? true,
    });
  }
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
    const product: any = await ProductV2Model.findById(productId).exec();

    if (!product) {
      throw new CatalogueAdminError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    if (input.slug !== undefined && input.slug !== product.slug) {
      const duplicate = await ProductV2Model.exists({
        slug: input.slug,
        _id: {
          $ne: productId,
        },
      }).exec();

      if (duplicate) {
        throw new CatalogueAdminError(
          'SLUG_ALREADY_EXISTS',
          'Product slug already exists'
        );
      }
    }

    applyProductInput(product, input);

    try {
      return await product.save();
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
    const product: any = await ProductV2Model.findById(productId).exec();

    if (!product) {
      throw new CatalogueAdminError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    const activeVariants = await VariantV2Model.find({
      productId,
      status: 'active',
    })
      .select('_id')
      .lean()
      .exec();

    const activeVariantIds = activeVariants.map(variant => variant._id);

    const activeInventoryCount = activeVariantIds.length
      ? await InventoryItemV2Model.countDocuments({
          variantId: {
            $in: activeVariantIds,
          },
          status: 'active',
        }).exec()
      : 0;

    const missing = getProductActivationMissingRequirements(
      product,
      {
        activeVariantCount: activeVariants.length,
        activeInventoryCount,
      }
    );

    if (missing.length > 0) {
      throw new CatalogueAdminError(
        'PRODUCT_NOT_READY',
        'Product is not ready for activation',
        missing
      );
    }

    product.status = 'active';
    product.seo = {
      title: product.seo?.title,
      description: product.seo?.description,
      noIndex: false,
    };

    try {
      return await product.save();
    } catch (error) {
      return translateModelValidation(error);
    }
  }

  async archiveProduct(productId: Types.ObjectId) {
    const product: any = await ProductV2Model.findById(productId).exec();

    if (!product) {
      throw new CatalogueAdminError(
        'PRODUCT_NOT_FOUND',
        'Product not found'
      );
    }

    if (product.status === 'active') {
      throw new CatalogueAdminError(
        'PRODUCT_ARCHIVE_REQUIRES_RESERVATION_REVIEW',
        'Active product archive requires reservation review'
      );
    }

    if (product.status === 'archived') {
      return product;
    }

    product.status = 'archived';
    product.seo = {
      title: product.seo?.title,
      description: product.seo?.description,
      noIndex: true,
    };

    return product.save();
  }
}

export const catalogueAdminService = new CatalogueAdminService();
