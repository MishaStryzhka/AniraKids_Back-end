const { HttpError } = require('../../helpers');
const { Product, User } = require('../../models');

const addToFavorites = async (req, res, next) => {
  const { user } = req;
  const { productId } = req.params;
  try {
    const product = await Product.findById(productId);
    if (!product) {
      throw new Error('Product not found');
    }

    if (user.favorites.includes(productId)) {
      next(HttpError(409, `This product is already in your favorites`));
    }

    const result = await User.findByIdAndUpdate(
      user._id,
      { $push: { favorites: productId } },
      { new: true }
    ).populate('favorites');

    if (!result) {
      next(HttpError(404, 'Not found'));
    }

    res.status(201).json({
      message: 'Favorite product has been added',
      id: productId,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = addToFavorites;
