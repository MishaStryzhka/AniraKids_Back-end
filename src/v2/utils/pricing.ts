import {
  type MoneyAmount,
  type ProductV2,
  type RentalMode,
  type ReservationPricingTotals,
  type ResolvedRentalPricing,
  type Variant,
} from '../types/domain';
import { isMoneyAmount } from '../models/validation';

type RentalPricingProduct = Pick<
  ProductV2,
  'rentalEnabled' | 'rentalPrices' | 'defaultDeposit'
>;

type RentalPricingVariant = Pick<
  Variant,
  'rentalPriceOverrides' | 'depositOverride'
>;

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

const assertMoneyAmount = (value: number, name: string): void => {
  if (!isMoneyAmount(value) || !Number.isFinite(value)) {
    throw new PricingError(`${name} must be a non-negative integer amount in Kč`);
  }
};

export const resolveRentalPrice = (
  product: RentalPricingProduct,
  variant: RentalPricingVariant,
  rentalMode: RentalMode
): MoneyAmount => {
  if (!product.rentalEnabled) {
    throw new PricingError('Product is not enabled for rental');
  }

  const override = variant.rentalPriceOverrides?.[rentalMode];
  const productPrice = product.rentalPrices?.[rentalMode];
  const resolvedPrice = override ?? productPrice;

  if (resolvedPrice === undefined) {
    throw new PricingError(
      `Rental price is not configured for mode "${rentalMode}"`
    );
  }

  assertMoneyAmount(resolvedPrice, 'Rental price');
  return resolvedPrice;
};

export const resolveDeposit = (
  product: Pick<ProductV2, 'defaultDeposit'>,
  variant: Pick<Variant, 'depositOverride'>
): MoneyAmount => {
  const resolvedDeposit = variant.depositOverride ?? product.defaultDeposit;

  assertMoneyAmount(resolvedDeposit, 'Deposit');
  return resolvedDeposit;
};

export const resolveRentalPricing = (
  product: RentalPricingProduct,
  variant: RentalPricingVariant,
  rentalMode: RentalMode
): ResolvedRentalPricing => ({
  rentalPrice: resolveRentalPrice(product, variant, rentalMode),
  deposit: resolveDeposit(product, variant),
});

export const calculateReservationTotals = (
  items: readonly ResolvedRentalPricing[]
): ReservationPricingTotals => {
  let subtotal = 0;
  let deposit = 0;

  for (const [index, item] of items.entries()) {
    assertMoneyAmount(item.rentalPrice, `items[${index}].rentalPrice`);
    assertMoneyAmount(item.deposit, `items[${index}].deposit`);

    subtotal += item.rentalPrice;
    deposit += item.deposit;

    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(deposit)) {
      throw new PricingError('Reservation totals exceed safe integer range');
    }
  }

  const totalDue = subtotal + deposit;

  if (!Number.isSafeInteger(totalDue)) {
    throw new PricingError('Reservation totalDue exceeds safe integer range');
  }

  return {
    subtotal,
    deposit,
    totalDue,
  };
};
