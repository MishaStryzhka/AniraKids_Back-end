const jwt = require('jsonwebtoken');
const { HttpError } = require('../helpers');
const { User } = require('../models');

const { SECRET_KEY } = process.env;

const authenticate = async (req, res, next) => {
  const { authorization = '' } = req.headers;

  const [bearer, token] = authorization.split(' ');

  if (bearer !== 'Bearer') {
    next(HttpError(401, 'Not authorized'));
  }

  try {
    const { id } = jwt.verify(token, SECRET_KEY);
    const user = await User.findById(id);

    const validToken = user.tokens.some(item => item.token === token);

    if (!validToken) {
      return next(HttpError(401, 'Not authorized'));
    }
    req.user = user;
    req.user.token = token;
  } catch (error) {
    next(HttpError(401, 'Not authorized'));
  }

  next();
};

module.exports = authenticate;
