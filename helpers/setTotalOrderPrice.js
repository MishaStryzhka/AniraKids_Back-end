const calculateDays = require('./calculateDays');

const setTotalOrderPrice = function (next) {
  if (this.serviceType === 'rent') {
    const totalOrderPrice = calculateDays(this.rentalPeriods) * this.totalPrice;
    this.totalOrderPrice = totalOrderPrice;
  } else {
    this.totalOrderPrice = this.totalPrice;
  }
  next();
};

module.exports = setTotalOrderPrice;
