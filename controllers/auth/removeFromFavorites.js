const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const removeFromFavorites = async (req, res, next) => {
  const { user } = req;
  const { productId } = req.params;

  try {
    if (!user.favorites.includes(productId)) {
      next(HttpError(409, `This product is not found in your favorites`));
    }

    const result = await User.findByIdAndUpdate(
      user._id,
      { $pull: { favorites: productId } },
      { new: true }
    );

    if (!result) {
      next(HttpError(404, 'Not found'));
    }

    res.status(201).json({
      message: 'Product removed from favorites',
      id: productId,
    });
  } catch (error) {
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = removeFromFavorites;
