const calculateDays = require('./calculateDays');

const setTotalOrderDeposit = function (next) {
  if (this.serviceType === 'rent') {
    console.log('qqq');
    const itemsTotalDeposit = this.items.reduce((total, item) => {
      return total + item.price.deposit; // Обчислюємо загальну вартість для кожного продукту
    }, 0);
    // Оновлення поля totalDeposit у документі
    this.totalDeposit = itemsTotalDeposit;
    console.log('this', this);
  }
  next();
};

module.exports = setTotalOrderDeposit;
