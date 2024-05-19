const { User } = require('../../models');
const Product = require('../../models/product');

const addProdukt = async (req, res, next) => {
  if (req.files.photos && req.files.photos.length > 0) {
    req.body.photos = req.files.photos.map(el => ({
      path: el.path,
      certificatePublicID: el.filename,
    }));
  }

  const pickupAddress = JSON.parse(req.body.pickupAddress);
  const { pickupAddresses, _id } = req.user;
  if (!pickupAddresses.some(e => e.place_id === pickupAddress.place_id)) {
    pickupAddresses.push(pickupAddress);
    await User.findByIdAndUpdate(_id, { pickupAddresses });
  }

  const product = await Product.create({
    ...req.body,
    dailyRentalPrice: parseFloat(req.body.dailyRentalPrice) || null,
    hourlyRentalPrice: parseFloat(req.body.hourlyRentalPrice) || null,
    salePrice: parseFloat(req.body.salePrice) || null,
    owner: req.user._id,
    pickupAddress,
  });

  res.status(201).json({ product });
};

module.exports = addProdukt;
