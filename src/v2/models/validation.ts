export const isMoneyAmount = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

export const isNonNegativeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

export const isDateRangeValid = (
  startDate: Date | undefined,
  endDate: Date | undefined
): boolean => {
  if (!startDate || !endDate) {
    return true;
  }

  return endDate.getTime() >= startDate.getTime();
};
