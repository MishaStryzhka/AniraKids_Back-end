import type { Types } from 'mongoose';

export type MoneyAmount = number;

export const PRODUCT_STATUSES = ['draft', 'active', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_CATEGORIES = [
  'dress',
  'suit',
  'set',
  'accessory',
  'other',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PRODUCT_GENDERS = [
  'girls',
  'boys',
  'women',
  'men',
  'unisex',
] as const;
export type ProductGender = (typeof PRODUCT_GENDERS)[number];

export const PRODUCT_OCCASIONS = [
  'wedding',
  'birthday',
  'christening',
  'photoshoot',
  'celebration',
  'other',
] as const;
export type ProductOccasion = (typeof PRODUCT_OCCASIONS)[number];

export interface RentalPrices {
  studio?: MoneyAmount;
  external?: MoneyAmount;
}

export interface RentalPriceOverrides {
  studio?: MoneyAmount;
  external?: MoneyAmount;
}

export interface ProductPhoto {
  url: string;
  publicId: string;
  alt?: string;
}

export interface ProductSeo {
  title?: string;
  description?: string;
  noIndex: boolean;
}

export interface ProductV2 {
  name: string;
  slug: string;
  description?: string;
  category?: ProductCategory;
  gender?: ProductGender;
  color?: string;
  occasion: ProductOccasion[];
  ageTags: string[];
  brand?: string;
  familyLookGroup?: string;
  rentalEnabled: boolean;
  saleEnabled: boolean;
  rentalPrices?: RentalPrices;
  defaultSalePrice?: MoneyAmount;
  defaultDeposit: MoneyAmount;
  photos: ProductPhoto[];
  status: ProductStatus;
  seo: ProductSeo;
  createdAt?: Date;
  updatedAt?: Date;
}

export const VARIANT_STATUSES = ['active', 'inactive'] as const;
export type VariantStatus = (typeof VARIANT_STATUSES)[number];

export interface Variant {
  productId: Types.ObjectId;
  size: string;
  sku?: string;
  rentalPriceOverrides?: RentalPriceOverrides;
  salePriceOverride?: MoneyAmount;
  depositOverride?: MoneyAmount;
  status: VariantStatus;
  sortOrder: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const INVENTORY_ITEM_STATUSES = [
  'active',
  'maintenance',
  'retired',
] as const;
export type InventoryItemStatus = (typeof INVENTORY_ITEM_STATUSES)[number];

export const INVENTORY_CONDITIONS = [
  'excellent',
  'good',
  'fair',
  'damaged',
] as const;
export type InventoryCondition = (typeof INVENTORY_CONDITIONS)[number];

export interface InventoryItem {
  variantId: Types.ObjectId;
  internalCode: string;
  status: InventoryItemStatus;
  condition: InventoryCondition;
  notes?: string;
  acquiredAt?: Date;
  retiredAt?: Date;
  bookingRevision: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const RENTAL_MODES = ['studio', 'external'] as const;
export type RentalMode = (typeof RENTAL_MODES)[number];

export const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'prepared',
  'rented',
  'returned',
  'cancelled',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type FulfillmentMethod = 'pickup';

export interface ReservationItem {
  productId: Types.ObjectId;
  variantId: Types.ObjectId;
  inventoryItemId: Types.ObjectId;
  productNameSnapshot: string;
  sizeSnapshot: string;
  rentalPriceSnapshot: MoneyAmount;
  depositSnapshot: MoneyAmount;
}

export interface CustomerSnapshot {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface Reservation {
  reservationNumber: string;
  customerId?: Types.ObjectId;
  guestAccessTokenHash?: string;
  customerSnapshot: CustomerSnapshot;
  items: ReservationItem[];
  rentalMode: RentalMode;
  startDate: Date;
  endDate: Date;
  status: ReservationStatus;
  expiresAt?: Date | null;
  subtotal: MoneyAmount;
  deposit: MoneyAmount;
  totalDue: MoneyAmount;
  fulfillmentMethod?: FulfillmentMethod;
  paymentStatus: PaymentStatus;
  notes?: string;
  cancelledAt?: Date;
  cancellationReason?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const AVAILABILITY_BLOCK_REASONS = [
  'cleaning',
  'repair',
  'internal_use',
  'photoshoot',
  'other',
] as const;
export type AvailabilityBlockReason =
  (typeof AVAILABILITY_BLOCK_REASONS)[number];

export interface AvailabilityBlock {
  inventoryItemId: Types.ObjectId;
  startDate: Date;
  endDate: Date;
  reason: AvailabilityBlockReason;
  notes?: string;
  createdBy: Types.ObjectId;
  createdAt?: Date;
}
