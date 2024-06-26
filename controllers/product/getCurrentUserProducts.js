const { HttpError } = require('../../helpers');
const { User, Product } = require('../../models');

const getCurrentUserProducts = async (req, res, next) => {
  const { _id } = req.user;

  const user = await User.findById(_id);
  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  const page = req.query.page || 1;
  const pageSize = req.query.pageSize || 9;
  const skip = (page - 1) * pageSize;

  const products = await Product.find({ owner: _id, status: 'active' })
    .skip(skip)
    .limit(pageSize)
    .populate('owner', 'nickname avatar rating ratingCount');

  const totalProducts = await Product.find({ owner: _id, status: 'active' });

  res.status(201).json({ totalProducts: totalProducts.length, products });
};

module.exports = getCurrentUserProducts;
