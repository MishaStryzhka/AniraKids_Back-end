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
  price: { type: Number, required: true },
});

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
  typeRent: {
    type: String,
    enum: ['celebration', 'photosession'],
    required: true,
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
  },
  status: {
    type: String,
    default: 'create',
    enum: ['create', 'approved by owner', 'paid'],
  },
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
