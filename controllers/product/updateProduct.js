const Product = require('../../models/product');
const User = require('../../models/user');

const updateProdukt = async (req, res, next) => {
  const { productId } = req.params;

  const product = await Product.findById(productId);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }

  // =========== update photos =============

  const { photos } = req.files;
  let { metaData } = req.body;
  metaData = JSON.parse(metaData);

  const newPhotos = metaData.map(id => {
    if (product.photos.some(photo => photo._id.toString() === id)) {
      console.log('old', id);
      return product.photos.find(obj => obj._id.toString() === id);
    } else {
      console.log('new', id);
      const newFile = photos.find(obj => obj.originalname === id);
      return {
        path: newFile.path,
        certificatePublicID: newFile.filename,
      };
    }
  });

  console.log('req.body.deposit', req.body.deposit);
  req.body.photos = newPhotos;

  // ================ ================

  const pickupAddress = JSON.parse(req.body.pickupAddress);
  const { pickupAddresses, _id } = req.user;
  if (!pickupAddresses.some(e => e.place_id === pickupAddress.place_id)) {
    pickupAddresses.push(pickupAddress);
    await User.findByIdAndUpdate(_id, { pickupAddresses });
  }

  // ============ age =============
  const { age } = req.body;
  req.body.age = JSON.parse(age);

  // ============ childSize =============
  const { childSize } = req.body;
  req.body.childSize = JSON.parse(childSize);

  const updatedProduct = await Product.findByIdAndUpdate(productId, {
    ...req.body,
    dailyRentalPrice: parseFloat(req.body.dailyRentalPrice) || null,
    hourlyRentalPrice: parseFloat(req.body.hourlyRentalPrice) || null,
    deposit: parseFloat(req.body.deposit) || null,
    salePrice: parseFloat(req.body.salePrice) || null,
    owner: req.user._id,
    pickupAddress,
  });

  console.log('updatedProduct', updatedProduct);

  res.status(201).json({ updatedProduct });
};

module.exports = updateProdukt;
