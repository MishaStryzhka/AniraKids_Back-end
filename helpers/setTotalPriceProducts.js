const setTotalPriceProducts = function (next) {
  // Перевірка, чи this.items є масивом і чи містить елементи
  if (!Array.isArray(this.items) || this.items.length === 0) {
    throw new Error('Items array is empty or not an array');
  }

  // Обчислення загальної вартості продуктів
  const itemsTotalPrice = this.items.reduce((total, item) => {
    const itemPrice = (item.price && item.price.salePrice) || 0; // Отримуємо ціну продукту з урахуванням можливих варіантів
    return total + item.quantity * itemPrice; // Обчислюємо загальну вартість для кожного продукту
  }, 0);

  // Оновлення поля totalPrice у документі
  this.totalPrice = itemsTotalPrice;

  console.log('this', this);

  next(); // Викликаємо наступну функцію у потоці
};

module.exports = setTotalPriceProducts;
