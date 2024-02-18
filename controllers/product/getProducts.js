const { Product } = require('../../models');

const getProducts = async (req, res, next) => {
  const { page = 1, pageSize = 9, type, price, ...query } = req.query;

  // type rent or sale
  if (type === 'rent') query.rental = true;
  if (type === 'sale') query.sale = true;

  // range price

  if (price) {
    const [minPrice, maxPrice] = price.split('-').map(Number);
    query.$or = [
      { rentalPrice: { $gte: minPrice, $lte: maxPrice } },
      { salePrice: { $gte: minPrice, $lte: maxPrice } },
    ];
  }

  const skip = (page - 1) * pageSize;

  const products = await Product.find(query).skip(skip).limit(pageSize);

  const totalProducts = await Product.find();

  res.status(201).json({ totalProducts: totalProducts.length, products });
};

module.exports = getProducts;
