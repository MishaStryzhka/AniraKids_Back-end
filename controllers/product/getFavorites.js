const { User } = require('../../models');

const getFavorites = async (req, res, next) => {
  const { user } = req;
  //   const { page = 1, pageSize = 9, type, price, sort, ...query } = req.query;
  //   const skip = (page - 1) * pageSize;

  const { favorites: products } = await User.findById(user._id)
    .populate({
      path: 'favorites',
      populate: {
        path: 'owner',
        select: 'nickname avatar rating ratingCount',
      },
    })
    .select('favorites');

  const totalProducts = await User.findById(user._id)
    .populate({
      path: 'favorites',
      populate: {
        path: 'owner',
        select: 'nickname avatar rating ratingCount',
      },
    })
    .select('favorites');

  res.status(201).json({ totalProducts: totalProducts.length, products });
};

module.exports = getFavorites;
