const { Product } = require('../../models');

const getPopular = async (req, res, next) => {
  const categoryOptions = [
    'women`s category',
    'men`s category',
    'children`s category',
    'decoration category',
  ];

  const popularProductsByCategory = {};

  for (const category of categoryOptions) {
    const popularProducts = await Product.find({ category: category })
      .sort({ popularity: -1 }) // Сортування товарів за зменшенням популярності
      .limit(4) // Обмеження результату чотирма записами
      .exec();

    popularProductsByCategory[category] = popularProducts;
  }

  res.status(201).json(popularProductsByCategory);
};

module.exports = getPopular;
