const mongoose = require('mongoose');
const {
  removeOrderIdInUsersCart,
  setOrderIdInUsersCart,
  setQuantityDays,
  setTotalOrderPrice,
  handleMongooseRemoveInvalidOrder,
  setTotalPriceProducts,
} = require('../helpers');
const handleMongooseError = require('../helpers/handleMongooseError');

// Schema for an item in the cart
const cartItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'product',
    required: true,
  },
  quantity: { type: Number, default: 1 },
  price: {
    dailyRentalPrice: { type: Number },
    hourlyRentalPrice: { type: Number },
    salePrice: { type: Number },
  },
});

// Schema for recipient details
const recipientSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  email: { type: String },
  address: { type: String },
});

// Schema for order
const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  items: [cartItemSchema],
  createdAt: { type: Date, default: Date.now },
  rentalPeriods: { type: String },
  pickupAddress: { type: Object },
  serviceType: { type: String, enum: ['buy', 'rent'], required: true },
  totalPrice: { type: Number },
  totalOrderPrice: { type: Number },
  quantityDays: { type: Number },
  quantityHours: { type: Number },
  typeRent: {
    type: String,
    enum: ['celebration', 'photosession'],
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
  },
  status: {
    type: String,
    default: 'create',
    enum: [
      'create',
      'pending',
      'pending by owner',
      'approved by owner',
      'rejected by owner',
      'awaiting payment',
      'paid',
      'payment failed',
      'processing',
      'processed',
      'shipped',
      'ready for pickup',
      'in transit',
      'delivered',
      'completed',
      'cancelled',
      'return requested',
      'returned',
      'refund issued',
      'exchange completed',
      'on hold',
      'issue reported',
    ],
  },
  deliveryService: { type: String },
  recipient: recipientSchema,
});

orderSchema.pre(['save', 'findOneAndUpdate'], setOrderIdInUsersCart);

orderSchema.pre('deleteOne', removeOrderIdInUsersCart);

orderSchema.pre(['save', 'findOneAndUpdate'], setQuantityDays);

orderSchema.pre(['save', 'findOneAndUpdate'], setTotalPriceProducts);

orderSchema.pre(['save', 'findOneAndUpdate'], setTotalOrderPrice);

orderSchema.post('save', handleMongooseRemoveInvalidOrder);

orderSchema.post('save', handleMongooseError);

const Order = mongoose.model('order', orderSchema);

module.exports = Order;

// 1. Створення Замовлення
// --- create - замовлення створене

// 2. Підтвердження Замовлення
// --- pending by owner - очікує підтвердження власником.
// --- pending - замовлення очікує перевірки або додаткової інформації.
// --- approved by owner - замовлення схвалене власником продукту або послуги.
// --- rejected by owner - замовлення відхилене власником.

// 3. Оплата
// --- awaiting payment - замовлення очікує на оплату.
// --- paid - оплата успішно здійснена.
// --- payment failed - оплата не вдалася.

// 4. Обробка Замовлення
// --- processing - замовлення обробляється.
// --- processed - замовлення успішно оброблене.

// 5. Доставка або Видача
// --- shipped - замовлення відправлене (для товарів).
// --- ready for pickup - замовлення готове до видачі (для послуг або самовивозу).
// --- in transit - замовлення в дорозі.
// --- delivered - замовлення доставлене.

// 6. Завершення Замовлення
// --- completed - замовлення завершене (успішно доставлене або надана послуга).
// --- cancelled - замовлення скасоване.

// 7. Повернення або Обмін
// --- return requested - запит на повернення або обмін.
// --- returned - товар повернений.
// --- refund issued - відшкодування здійснене.
// --- exchange completed - обмін здійснений.

// 8. Інші Можливі Статуси
// --- on hold - замовлення на паузі (можливо через клієнтське звернення або інші причини).
// --- issue reported - повідомлення про проблему із замовленням.
