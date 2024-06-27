const { Product } = require('../../models');

const getPopular = async (req, res, next) => {
  const categoryOptions = [
    'forWomen', // 'women`s category'
    'forMen', // 'men`s category'
    'forChildren', // 'children`s category'
    'decorAndToys', // 'decoration category'
  ];

  const popularProductsByCategory = {};

  for (const category of categoryOptions) {
    const popularProducts = await Product.find({
      category: category,
      status: 'active',
    })
      .populate('owner', 'nickname avatar rating ratingCount')
      .sort({ popularity: -1 }) // Сортування товарів за зменшенням популярності
      .limit(4) // Обмеження результату чотирма записами
      .exec();

    popularProductsByCategory[category] = popularProducts;
  }

  res.status(201).json(popularProductsByCategory);
};

module.exports = getPopular;
