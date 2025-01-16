const setTotalPriceProducts = function (next) {
  const { serviceType, typeRent, quantityDays, quantityHours } = this;

  // ==================================
  // =========== celebration ==========
  // ==================================

  if (serviceType === 'rent' && typeRent === 'celebration') {
    // Обчислення загальної вартості продуктів
    const itemsTotalPrice = this.items.reduce((total, item) => {
      return total + item.quantity * item.price.dailyRentalPrice * quantityDays; // Обчислюємо загальну вартість для кожного продукту
    }, 0);
    // Оновлення поля totalPrice у документі
    this.totalPrice = itemsTotalPrice;
  }

  // ==================================
  // =========== photosession =========
  // ==================================

  if (serviceType === 'rent' && typeRent === 'photosession') {
    // Обчислення загальної вартості продуктів
    const itemsTotalPrice = this.items.reduce((total, item) => {
      console.log('item', item);

      return (
        total + item.quantity * item.price.hourlyRentalPrice * quantityHours
      ); // Обчислюємо загальну вартість для кожного продукту
    }, 0);
    // Оновлення поля totalPrice у документі
    this.totalPrice = itemsTotalPrice;
  }

  // ==================================
  // ============== buy ===============
  // ==================================

  if (serviceType === 'buy') {
    // Обчислення загальної вартості продуктів
    const itemsTotalPrice = this.items.reduce((total, item) => {
      return total + item.quantity * item.price.salePrice; // Обчислюємо загальну вартість для кожного продукту
    }, 0);

    // Оновлення поля totalPrice у документі
    this.totalPrice = itemsTotalPrice;
  }

  next(); // Викликаємо наступну функцію у потоці
};

module.exports = setTotalPriceProducts;
