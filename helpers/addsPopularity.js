const addsPopularity = async function (next) {
  this.popularity = this.viewsCount + this.rentCount * 10 + this.rating * 100;
  next();
};

module.exports = addsPopularity;
