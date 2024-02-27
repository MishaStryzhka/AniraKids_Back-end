const Product = require('../../models/product');

const addProdukt = async (req, res, next) => {
  if (req.files.photos) {
    req.body.photos = [];
    req.files.photos.map(el =>
      req.body.photos.push({
        path: el.path,
        certificatePublicID: el.filename,
      })
    );
  }

  const product = await Product.create({
    videoUrl: req.body.videoUrl,
    name: req.body.name,
    description: req.body.description,
    brand: req.body.brand,
    category: req.body.category,
    familyLook: req.body.familyLook,
    isPregnancy: req.body.isPregnancy,
    subject: req.body.subject,
    outfits: req.body.outfits,
    childSize: req.body.childSize,
    age: req.body.age,
    toys: req.body.toys,
    size: req.body.size,
    color: req.body.color,
    rental: req.body.rental === 'true',
    sale: req.body.sale === 'true',
    dailyRentalPrice: parseFloat(req.body.dailyRentalPrice) || null,
    hourlyRentalPrice: parseFloat(req.body.hourlyRentalPrice) || null,
    salePrice: parseFloat(req.body.salePrice) || null,
    keyWord: req.body.keyWord,
    photos: req.body.photos,
    isAddPhoto: req.body.isAddPhoto,
    owner: req.user._id,
  });

  res.status(201).json({ product });
};

module.exports = addProdukt;
