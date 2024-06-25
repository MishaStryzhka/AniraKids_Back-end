const formatDate = require('./formatDate');

const handleMongooseRemoveInvalidOrder = async function (doc) {
  const { serviceType, rentalPeriods } = doc;

  if (serviceType === 'rent') {
    let startDate = null;
    if (rentalPeriods.includes('-')) {
      [startDate] = rentalPeriods.split('-');
    } else {
      startDate = rentalPeriods;
    }

    if (
      doc.status === 'create' &&
      new Date(formatDate(startDate)) < new Date()
    ) {
      await doc.remove();
    }
  }
};

module.exports = handleMongooseRemoveInvalidOrder;
