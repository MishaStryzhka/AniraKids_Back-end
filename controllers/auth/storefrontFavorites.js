const { Types } = require('mongoose');
const { User } = require('../../models');
const { ProductV2Model } = require('../../build/v2/models');
const { HttpError } = require('../../helpers');
const validId = value => typeof value === 'string' && /^[a-f\d]{24}$/.test(value);
const reply = (res, user) => {
  if (!user) throw HttpError(404, 'Account not found');
  res.set('Cache-Control', 'no-store');
  return res.status(200).json({ ids: [...new Set((user.favorites || []).map(String))] });
};
exports.read = async (req, res) => reply(res, await User.findById(req.user._id).select('favorites'));
exports.add = async (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length > 100 || !ids.every(validId) || Object.keys(req.body).some(key => key !== 'ids'))
    throw HttpError(400, 'Invalid favorites');
  const products = await ProductV2Model.find({ _id: { $in: ids }, status: 'active', rentalEnabled: true }).select('_id').lean();
  const accepted = products.map(product => new Types.ObjectId(product._id));
  // Atomic union: adding from a second tab/device must never overwrite earlier choices.
  const user = await User.findOneAndUpdate({ _id: req.user._id,
    $expr: { $lte: [{ $size: { $setUnion: [{ $ifNull: ['$favorites', []] }, accepted] } }, 100] },
  }, { $addToSet: { favorites: { $each: accepted } } }, { new: true }).select('favorites');
  if (!user) throw HttpError(409, 'Favorites limit reached');
  return reply(res, user);
};
exports.remove = async (req, res) => {
  if (!validId(req.params.productId)) throw HttpError(400, 'Invalid product');
  return reply(res, await User.findByIdAndUpdate(req.user._id,
    { $pull: { favorites: req.params.productId } }, { new: true }).select('favorites'));
};
