"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDateRangeValid = exports.isNonNegativeInteger = exports.isMoneyAmount = void 0;
const isMoneyAmount = (value) => Number.isInteger(value) && value >= 0;
exports.isMoneyAmount = isMoneyAmount;
const isNonNegativeInteger = (value) => Number.isInteger(value) && value >= 0;
exports.isNonNegativeInteger = isNonNegativeInteger;
const isDateRangeValid = (startDate, endDate) => {
    if (!startDate || !endDate) {
        return true;
    }
    return endDate.getTime() >= startDate.getTime();
};
exports.isDateRangeValid = isDateRangeValid;
