const { HttpError } = require('../../helpers');
const { User } = require('../../models');
const publicUser = require('../../helpers/publicUser');
const updateSchema = require('../../schemas/users/updateSchema');

const updateCurrentUser = async (req, res) => {
  // Multipart fields are available only after the upload middleware.
  const { error, value } = updateSchema.validate(req.body || {});
  if (error) throw HttpError(400, error.message);
  const user = await User.findById(req.user._id);
  if (!user) throw HttpError(401, 'Not authorized');
  if (value.newPassword || value.confirmNewPassword) {
    throw HttpError(400, 'Use the password reset flow');
  }
  const email = value.email?.trim().toLowerCase();
  if (email && user.email && email !== user.email.toLowerCase()) {
    throw HttpError(400, 'Use the email change flow');
  }
  const changes = {};
  for (const key of ['firstName', 'lastName', 'patronymic', 'companyName', 'ico', 'nickname', 'primaryPhoneNumber']) {
    if (value[key] !== undefined && value[key] !== user[key]) changes[key] = value[key];
  }
  if (email && !user.email) { changes.email = email; changes.emailVerified = false; }
  for (const [key, message] of [
    ['nickname', 'Nickname must be unique'],
    ['email', 'Email in use'],
    ['primaryPhoneNumber', 'Phone number in use'],
  ]) {
    if (changes[key] && await User.exists({ [key]: changes[key], _id: { $ne: user._id } })) {
      throw HttpError(409, message);
    }
  }
  if (changes.primaryPhoneNumber) changes.primaryPhoneNumberVerified = false;
  const avatar = req.files?.avatar?.[0];
  if (avatar) { changes.avatar = avatar.path; changes.avatarPublicId = avatar.filename; }
  user.set({ ...changes, isFirstLogin: false });
  try {
    // Legacy optional nested fields must not block an unrelated profile edit.
    await user.save({ validateModifiedOnly: true });
  } catch (error) {
    if (error.code === 11000) {
      const messages = { nickname: 'Nickname must be unique', email: 'Email in use', primaryPhoneNumber: 'Phone number in use' };
      throw HttpError(409, messages[Object.keys(error.keyPattern || {})[0]] || 'Profile value already in use');
    }
    if (error.name === 'ValidationError') throw HttpError(400, error.message);
    throw error;
  }
  res.status(200).json({ user: publicUser(user) });
};
module.exports = updateCurrentUser;
