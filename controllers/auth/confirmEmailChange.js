const crypto = require('node:crypto');
const { HttpError } = require('../../helpers');
const { User } = require('../../models');

module.exports = async (req, res) => {
  const token = req.body?.token;
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw HttpError(400, 'Invalid email change link');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({ pendingEmailTokenHash: hash, pendingEmailExpiresAt: { $gt: new Date() } })
    .select('+pendingEmail +pendingEmailOldAddress');
  if (!user) throw HttpError(400, 'Expired or already used email change link');
  let updated;
  try {
    // Match and consume the exact outstanding request in the same database write.
    updated = await User.findOneAndUpdate({ _id: user._id, email: user.pendingEmailOldAddress,
      pendingEmailTokenHash: hash, pendingEmailExpiresAt: { $gt: new Date() } }, {
      $set: { email: user.pendingEmail, emailVerified: true },
      $unset: { pendingEmail: '', pendingEmailTokenHash: '', pendingEmailExpiresAt: '', pendingEmailOldAddress: '' },
    }, { new: true, runValidators: true });
  } catch (error) {
    if (error.code === 11000) throw HttpError(409, 'Email in use');
    if (error.name === 'ValidationError') throw HttpError(400, 'Invalid email address');
    throw error;
  }
  if (!updated) throw HttpError(400, 'Expired or already used email change link');
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ user: { userID: String(updated._id), email: updated.email, emailVerified: true } });
};
