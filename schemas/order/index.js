const addToOrderSchema = require('./addToOrderSchemas');
const orderConfirmByUserSchema = require('./orderConfirmByUserSchema');
const setQuantityHoursSchema = require('./setQuantityHoursSchema');
const setQuantitySchema = require('./setQuantitySchema');

module.exports = {
  setQuantitySchema,
  setQuantityHoursSchema,
  addToOrderSchema,
  orderConfirmByUserSchema,
};
