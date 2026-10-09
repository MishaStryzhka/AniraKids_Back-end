const { HttpError } = require('../../helpers');
const { User } = require('../../models');
module.exports = async (req, res) => {
  const user = await User.findById(req.params.id).select('nickname avatar');
  if (!user) throw HttpError(404, 'Not found');
  res.status(200).json({ user: { userID: String(user._id), nickname: user.nickname, avatar: user.avatar } });
};
