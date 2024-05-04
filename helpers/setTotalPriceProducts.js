const setTotalPriceProducts = function (next) {
  const itemsTotalPrice = this.items.reduce(
    (total, item) => total + item.quantity * item.price,
    0
  );
  this.totalPrice = itemsTotalPrice;
  next();
};

module.exports = setTotalPriceProducts;
