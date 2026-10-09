const { User } = require('../../models');
const { HttpError } = require('../../helpers');
const action = require('../../helpers/accountAction');
module.exports = async (req, res) => {
  const token = req.body?.token;
  if (!action.validToken(token)) throw HttpError(400, 'Invalid verification link');
  const hash = action.hashToken(token);
  const user = await User.findOne({ 'emailVerification.hash': hash, 'emailVerification.expiresAt': { $gt: new Date() } }).select('+emailVerification');
  if (!user) throw HttpError(400, 'Expired or already used verification link');
  const updated = await User.findOneAndUpdate({ _id: user._id, email: user.emailVerification.email, 'emailVerification.hash': hash, 'emailVerification.expiresAt': { $gt: new Date() } }, { $set: { emailVerified: true }, $unset: { emailVerification: '' } }, { new: true });
  if (!updated) throw HttpError(400, 'Expired or already used verification link');
  res.set('Cache-Control', 'no-store'); res.status(200).json({ user: { userID: String(updated._id), email: updated.email, emailVerified: true } });
};
