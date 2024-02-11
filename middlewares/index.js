const authenticate = require('./authenticate');
const validateBody = require('./validateBody');
const upload = require('./upload');
const validateQuery = require('./validateQuery');
const validateId = require('./validateId');
const uploadCloud = require('./uploadCloud');
const passport = require('./passport-authenticate');
const imageProcessingMiddleware = require('./imageProcessingMiddleware');

module.exports = {
  validateBody,
  authenticate,
  upload,
  validateQuery,
  validateId,
  uploadCloud,
  passport,
  imageProcessingMiddleware,
};
