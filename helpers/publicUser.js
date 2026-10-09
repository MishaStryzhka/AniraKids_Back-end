// Session credentials and password hashes must never be returned as profile data.
module.exports = function publicUser(user) {
  const { password, token, tokens, __v, ...profile } = user.toObject ? user.toObject() : user._doc;
  return { ...profile, userID: String(user._id) };
};
