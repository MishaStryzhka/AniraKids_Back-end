const cron = require('node-cron');
const updateAbandonedOrders = require('./js-abandoned');

// Налаштування CRON-завдання
cron.schedule('0 0 * * *', async () => {
  console.log('Running CRON job to update abandoned orders...');

  try {
    await updateAbandonedOrders();
  } catch (error) {
    console.error('Error updating orders to abandoned:', error);
  }
});
