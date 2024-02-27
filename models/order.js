const mongoose = require('mongoose');
const { handleMongooseError } = require('../helpers');

// Schema for an item in the cart
const cartItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'product',
    required: true,
  },
  serviceType: { type: String, enum: ['buy', 'rent'], required: true },
  quantity: { type: Number, default: 1 },
  price: { type: Number, required: true },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'user',
    required: true,
  },
});

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'user', required: true },
  items: [cartItemSchema],
  createdAt: { type: Date, default: Date.now },
});

orderSchema.post('save', handleMongooseError);

const Order = mongoose.model('order', orderSchema);

module.exports = Order;
