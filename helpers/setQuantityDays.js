const calculateDays = require('./calculateDays');

const setQuantityDays = function (next) {
  if (this.serviceType === 'rent') {
    const quantityDays = calculateDays(this.rentalPeriods);
    this.quantityDays = quantityDays;
  }
  next();
};

module.exports = setQuantityDays;
