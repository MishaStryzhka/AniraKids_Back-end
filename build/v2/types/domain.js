"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AVAILABILITY_BLOCK_REASONS = exports.PAYMENT_STATUSES = exports.RESERVATION_STATUSES = exports.RENTAL_MODES = exports.INVENTORY_CONDITIONS = exports.INVENTORY_ITEM_STATUSES = exports.VARIANT_STATUSES = exports.PRODUCT_OCCASIONS = exports.PRODUCT_GENDERS = exports.PRODUCT_CATEGORIES = exports.PRODUCT_STATUSES = void 0;
exports.PRODUCT_STATUSES = ['draft', 'active', 'archived'];
exports.PRODUCT_CATEGORIES = [
    'dress',
    'suit',
    'set',
    'accessory',
    'other',
];
exports.PRODUCT_GENDERS = [
    'girls',
    'boys',
    'women',
    'men',
    'unisex',
];
exports.PRODUCT_OCCASIONS = [
    'wedding',
    'birthday',
    'christening',
    'photoshoot',
    'celebration',
    'other',
];
exports.VARIANT_STATUSES = ['active', 'inactive'];
exports.INVENTORY_ITEM_STATUSES = [
    'active',
    'maintenance',
    'retired',
];
exports.INVENTORY_CONDITIONS = [
    'excellent',
    'good',
    'fair',
    'damaged',
];
exports.RENTAL_MODES = ['studio', 'external'];
exports.RESERVATION_STATUSES = [
    'pending',
    'confirmed',
    'prepared',
    'rented',
    'returned',
    'cancelled',
];
exports.PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'];
exports.AVAILABILITY_BLOCK_REASONS = [
    'cleaning',
    'repair',
    'internal_use',
    'photoshoot',
    'other',
];
