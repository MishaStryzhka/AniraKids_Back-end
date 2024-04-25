const mongoose = require('mongoose');
const { handleMongooseError } = require('../helpers');
const handleMongooseRemoveInvalidOrder = require('../helpers/handleMongooseRemoveInvalidOrder');

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

orderSchema.post('save', handleMongooseRemoveInvalidOrder);

orderSchema.post('save', handleMongooseError);

const Order = mongoose.model('order', orderSchema);

module.exports = Order;
