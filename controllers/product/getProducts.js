const { Product } = require('../../models');

const getProducts = async (req, res, next) => {
  const { page = 1, pageSize = 9, type, price, sort, ...query } = req.query;

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

  let sortCriteria = {};

  // Define sorting criteria based on the 'sort' parameter
  if (sort === 'popularity') {
    sortCriteria = { popularity: -1 };
  } else if (sort === 'expensive to cheap') {
    sortCriteria = { rentalPrice: -1, salePrice: -1 };
  } else if (sort === 'cheap to expensive') {
    sortCriteria = { rentalPrice: 1, salePrice: 1 };
  } else if (sort === 'new arrival') {
    sortCriteria = { createdAt: -1 };
  }

  const skip = (page - 1) * pageSize;

  const products = await Product.find(query)
    .sort(sortCriteria)
    .skip(skip)
    .limit(pageSize);

  const totalProducts = await Product.find(query)
    .sort(sortCriteria)
    .skip(skip)
    .limit(pageSize).length;

  res.status(201).json({ totalProducts, products });
};

module.exports = getProducts;
