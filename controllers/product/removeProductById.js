const { HttpError } = require('../../helpers');
const { Product } = require('../../models');

const removeProductById = async (req, res, next) => {
  const { id } = req.params;
  const { _id } = req.user;

  const deletedProduct = await Product.findByIdAndDelete({ _id: id });

  if (!deletedProduct) {
    next(HttpError(404, 'Product not found'));
  }

  const totalProducts = await Product.find({ owner: _id });

  res.status(200).json({ totalProducts: totalProducts.length, deletedProduct });
};

module.exports = removeProductById;
