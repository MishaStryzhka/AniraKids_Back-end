"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateReservationTotals = exports.resolveRentalPricing = exports.resolveDeposit = exports.resolveRentalPrice = exports.PricingError = void 0;
const validation_1 = require("../models/validation");
class PricingError extends Error {
    constructor(message) {
        super(message);
        this.name = 'PricingError';
    }
}
exports.PricingError = PricingError;
const assertMoneyAmount = (value, name) => {
    if (!(0, validation_1.isMoneyAmount)(value) || !Number.isFinite(value)) {
        throw new PricingError(`${name} must be a non-negative integer amount in Kč`);
    }
};
const resolveRentalPrice = (product, variant, rentalMode) => {
    if (!product.rentalEnabled)
        throw new PricingError('Product is not enabled for rental');
    const override = variant.rentalPriceOverrides?.[rentalMode];
    const productPrice = product.rentalPrices?.[rentalMode];
    const resolvedPrice = override ?? productPrice;
    if (resolvedPrice === undefined)
        throw new PricingError(`Rental price is not configured for mode "${rentalMode}"`);
    assertMoneyAmount(resolvedPrice, 'Rental price');
    return resolvedPrice;
};
exports.resolveRentalPrice = resolveRentalPrice;
const resolveDeposit = (product, variant) => {
    const resolvedDeposit = variant.depositOverride ?? product.defaultDeposit;
    assertMoneyAmount(resolvedDeposit, 'Deposit');
    return resolvedDeposit;
};
exports.resolveDeposit = resolveDeposit;
const resolveRentalPricing = (product, variant, rentalMode) => ({ rentalPrice: (0, exports.resolveRentalPrice)(product, variant, rentalMode), deposit: (0, exports.resolveDeposit)(product, variant) });
exports.resolveRentalPricing = resolveRentalPricing;
const calculateReservationTotals = (items) => {
    let subtotal = 0;
    let deposit = 0;
    for (const [index, item] of items.entries()) {
        assertMoneyAmount(item.rentalPrice, `items[${index}].rentalPrice`);
        assertMoneyAmount(item.deposit, `items[${index}].deposit`);
        subtotal += item.rentalPrice;
        deposit += item.deposit;
        if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(deposit))
            throw new PricingError('Reservation totals exceed safe integer range');
    }
    const totalDue = subtotal + deposit;
    if (!Number.isSafeInteger(totalDue))
        throw new PricingError('Reservation totalDue exceeds safe integer range');
    return { subtotal, deposit, totalDue };
};
exports.calculateReservationTotals = calculateReservationTotals;
