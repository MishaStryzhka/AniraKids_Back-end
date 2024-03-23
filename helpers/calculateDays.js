const { differenceInDays, parse } = require('date-fns');

const calculateDays = rentalPeriods => {
  // Розділяємо рядок за допомогою дефісу (-)
  const [startDateStr, endDateStr] = rentalPeriods.split('-');

  if (!endDateStr) return 1;
  // Парсимо рядки дат у об'єкти Date
  const startDate = parse(startDateStr, 'dd.MM.yyyy', new Date());
  const endDate = parse(endDateStr, 'dd.MM.yyyy', new Date());

  // Розраховуємо різницю між датами в днях
  const difference = differenceInDays(endDate, startDate);

  // Повертаємо кількість днів
  return difference;
};

module.exports = calculateDays;
