const { Product } = require('../../models');

const getProductById = async (req, res, next) => {
  const { id } = req.params;
  console.log('id', id);

  const product = await Product.findById(id).populate(
    'owner',
    'nickname avatar rating ratingCount'
  );

  res.status(201).json({ product });
};

module.exports = getProductById;
