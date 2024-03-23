const { HttpError } = require('../../helpers');
const { Product } = require('../../models');

const removeProductById = async (req, res, next) => {
  const { id } = req.params;
  const { _id } = req.user;

  try {
    const deletedProduct = await Product.findByIdAndUpdate(id, { status: 'inactive' });

    if (!deletedProduct) {
      return next(HttpError(404, 'Product not found'));
    }

    const totalProducts = await Product.find({ owner: _id });

    res.status(200).json({ totalProducts: totalProducts.length, deletedProduct });
  } catch (error) {
    console.error('Error removing product:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = removeProductById;
