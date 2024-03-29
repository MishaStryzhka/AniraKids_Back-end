const { HttpError } = require('../../helpers');
const { User } = require('../../models');

const updateLanguage = async (req, res, next) => {
  const { _id } = req.user;
  const user = await User.findById(_id);

  console.log('req', req.query);

  if (!user) {
    next(HttpError(401, 'Not authorized'));
  }

  const updatedUser = await User.findByIdAndUpdate(
    _id,
    { ...req.query },
    {
      new: true,
    }
  );

  res.status(200).json({
    language: updatedUser.language,
  });
};

module.exports = updateLanguage;
