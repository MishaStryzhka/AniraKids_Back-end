const formatDate = require('../helpers/formatDate');
const Order = require('../models/order');

// Функція для перевірки, чи потрібно встановити статус abandoned
const isRentalPeriodAbandoned = rentalPeriods => {
  console.log('rentalPeriods', rentalPeriods);
  const currentDate = new Date();

  if (rentalPeriods.includes('-')) {
    // Якщо це діапазон дат
    const [startDate] = rentalPeriods
      .split('-')
      .map(date => new Date(formatDate(date.trim())));
    console.log('startDate', startDate);

    const oneDayBeforeStart = new Date(startDate);
    oneDayBeforeStart.setDate(startDate.getDate() - 1);

    console.log(
      'currentDate > oneDayBeforeStart',
      currentDate > oneDayBeforeStart
    );
    return currentDate > oneDayBeforeStart;
  } else {
    // Якщо це одиночна дата
    const rentalDate = new Date(formatDate(rentalPeriods.trim()));
    console.log('rentalDate', rentalDate);

    const oneDayBefore = new Date(rentalDate);
    oneDayBefore.setDate(rentalDate.getDate() - 1);

    console.log('currentDate > oneDayBefore', currentDate > oneDayBefore);
    return currentDate > oneDayBefore;
  }
};

// Функція для оновлення статусу замовлень
const updateAbandonedOrders = async () => {
  try {
    const orders = await Order.find({ status: 'create' });

    let updatedCount = 0;

    for (const order of orders) {
      const rentalPeriods = order.rentalPeriods;

      if (rentalPeriods && isRentalPeriodAbandoned(rentalPeriods)) {
        order.status = 'abandoned';
        await order.save();
        updatedCount++;
      }
    }

    console.log(`Updated ${updatedCount} orders to 'abandoned' status.`);
  } catch (error) {
    console.error('Error updating orders to abandoned:', error);
  }
};

module.exports = updateAbandonedOrders;
