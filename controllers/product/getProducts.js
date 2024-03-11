const { Product } = require('../../models');

const getProducts = async (req, res, next) => {
  const {
    age,
    childSize,
    color,
    page = 1,
    pageSize = 9,
    type,
    price,
    sort,
    rentalPeriods,
    ...query
  } = req.query;

  // age
  if (age) {
    const paramsAge = age.split(',');
    query.age = { $in: paramsAge };
  }

  // childSize
  if (childSize) {
    const paramsChildSize = childSize.split(',');
    query.childSize = { $in: paramsChildSize };
  }

  // color
  if (color) {
    const paramsColor = color.split(',');
    query.color = { $in: paramsColor };
  }

  // type rent or sale
  if (rentalPeriods) {
    let startDate = null;
    let endDate = null;
    if (rentalPeriods.includes('-')) {
      [startDate, endDate] = rentalPeriods.split('-');
    } else {
      startDate = rentalPeriods;
      endDate = rentalPeriods;
    }

    const formatDate = date => {
      const qwe = date.split('.');
      return `${qwe[1]}.${qwe[0]}.${qwe[2]}`;
    }; // 'MM.dd.yyyy'

    query.rentalPeriods = {
      $not: {
        $elemMatch: {
          startDate: { $lt: new Date(formatDate(endDate)) },
          endDate: { $gt: new Date(formatDate(startDate)) },
        },
      },
    };
  }

  // type rent or sale

  if (type === 'rent') query.rental = true;
  if (type === 'sale') query.sale = true;

  // range price

  if (price) {
    const [minPrice, maxPrice] = price.split('-').map(Number);
    query.$or = [
      { dailyRentalPrice: { $gte: minPrice, $lte: maxPrice } },
      { hourlyRentalPrice: { $gte: minPrice, $lte: maxPrice } },
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

  const products = await Product.find({ ...query })
    .sort(sortCriteria)
    .skip(skip)
    .limit(pageSize)
    .populate('owner', 'nickname avatar rating ratingCount');

  const totalProducts = await Product.find(query)
    .sort(sortCriteria)
    .skip(skip)
    .limit(pageSize).length;

  res.status(201).json({ totalProducts, products });
};

module.exports = getProducts;
