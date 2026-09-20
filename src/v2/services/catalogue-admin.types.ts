import type { Types } from 'mongoose';

import type {
  InventoryCondition,
  ProductCategory,
  ProductGender,
  ProductOccasion,
  ProductStatus,
  VariantStatus,
} from '../types/domain';

export type CatalogueAdminErrorCode =
  | 'VALIDATION_ERROR'
  | 'PRODUCT_NOT_FOUND'
  | 'VARIANT_NOT_FOUND'
  | 'INVENTORY_ITEM_NOT_FOUND'
  | 'SLUG_ALREADY_EXISTS'
  | 'VARIANT_SIZE_ALREADY_EXISTS'
  | 'SKU_ALREADY_EXISTS'
  | 'INVENTORY_CODE_ALREADY_EXISTS'
  | 'PRODUCT_NOT_READY'
  | 'PRODUCT_ARCHIVE_REQUIRES_RESERVATION_REVIEW'
  | 'DAMAGED_ITEM_REQUIRES_MAINTENANCE';

export class CatalogueAdminError extends Error {
  constructor(
    public readonly code: CatalogueAdminErrorCode,
    message: string,
    public readonly details?: string[]
  ) {
    super(message);
    this.name = 'CatalogueAdminError';
  }
}

export interface CatalogueProductListOptions {
  status?: ProductStatus;
  category?: ProductCategory;
  gender?: ProductGender;
  rentalEnabled?: boolean;
  page: number;
  limit: number;
}

export interface CatalogueProductCreateInput {
  name: string;
  slug?: string;
  description?: string;
  category?: ProductCategory;
  gender?: ProductGender;
  color?: string;
  occasion?: ProductOccasion[];
  ageTags?: string[];
  brand?: string;
  familyLookGroup?: string;
  rentalEnabled?: boolean;
  saleEnabled?: boolean;
  rentalPrices?: {
    studio?: number;
    external?: number;
  };
  defaultSalePrice?: number;
  defaultDeposit?: number;
  seo?: {
    title?: string;
    description?: string;
  };
}

export type CatalogueProductUpdateInput = Partial<CatalogueProductCreateInput>;

export interface CatalogueVariantCreateInput {
  size: string;
  sku?: string;
  rentalPriceOverrides?: {
    studio?: number;
    external?: number;
  };
  salePriceOverride?: number;
  depositOverride?: number;
  sortOrder?: number;
  status?: VariantStatus;
}

export interface CatalogueVariantUpdateInput {
  size?: string;
  sku?: string;
  rentalPriceOverrides?: {
    studio?: number;
    external?: number;
  };
  salePriceOverride?: number;
  depositOverride?: number;
  sortOrder?: number;
}

export interface CatalogueInventoryCreateInput {
  internalCode: string;
  condition?: InventoryCondition;
  notes?: string;
  acquiredAt?: Date;
}

export interface CatalogueInventoryUpdateInput {
  condition?: InventoryCondition;
  notes?: string;
  acquiredAt?: Date;
}

export interface CatalogueActivationContext {
  activeVariantCount: number;
  activeInventoryCount: number;
}

export interface ProductIdentity {
  _id: Types.ObjectId;
}
