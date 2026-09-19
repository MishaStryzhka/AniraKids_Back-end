"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBusinessDateOnly = exports.calculateRentalDays = exports.addCalendarDays = exports.compareDateOnly = exports.isCanonicalDateOnlyDate = exports.formatDateOnly = exports.parseDateOnly = void 0;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const BUSINESS_TIME_ZONE = 'Europe/Prague';
const businessDateFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});
const assertValidDate = (date, name) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new TypeError(`${name} must be a valid Date`);
    }
};
const assertCanonicalDateOnlyDate = (date, name) => {
    assertValidDate(date, name);
    if (!(0, exports.isCanonicalDateOnlyDate)(date)) {
        throw new RangeError(`${name} must be a canonical date-only Date at 00:00:00.000Z`);
    }
};
const parseDateOnly = (value) => {
    const match = DATE_ONLY_PATTERN.exec(value);
    if (!match) {
        throw new RangeError('Date must use strict YYYY-MM-DD format');
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
        throw new RangeError(`Invalid calendar date: ${value}`);
    }
    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(year, month - 1, day);
    if (date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day) {
        throw new RangeError(`Invalid calendar date: ${value}`);
    }
    return date;
};
exports.parseDateOnly = parseDateOnly;
const formatDateOnly = (date) => {
    assertValidDate(date, 'date');
    const year = String(date.getUTCFullYear()).padStart(4, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
exports.formatDateOnly = formatDateOnly;
const isCanonicalDateOnlyDate = (date) => date instanceof Date &&
    !Number.isNaN(date.getTime()) &&
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;
exports.isCanonicalDateOnlyDate = isCanonicalDateOnlyDate;
const compareDateOnly = (a, b) => {
    assertCanonicalDateOnlyDate(a, 'a');
    assertCanonicalDateOnlyDate(b, 'b');
    if (a.getTime() < b.getTime())
        return -1;
    if (a.getTime() > b.getTime())
        return 1;
    return 0;
};
exports.compareDateOnly = compareDateOnly;
const addCalendarDays = (date, amount) => {
    assertCanonicalDateOnlyDate(date, 'date');
    if (!Number.isInteger(amount)) {
        throw new TypeError('amount must be an integer number of calendar days');
    }
    const result = new Date(date.getTime());
    result.setUTCDate(result.getUTCDate() + amount);
    return result;
};
exports.addCalendarDays = addCalendarDays;
const calculateRentalDays = (startDate, endDate) => {
    assertCanonicalDateOnlyDate(startDate, 'startDate');
    assertCanonicalDateOnlyDate(endDate, 'endDate');
    if ((0, exports.compareDateOnly)(endDate, startDate) < 0) {
        throw new RangeError('endDate must be on or after startDate');
    }
    return Math.trunc((endDate.getTime() - startDate.getTime()) / MILLISECONDS_PER_DAY) + 1;
};
exports.calculateRentalDays = calculateRentalDays;
const getBusinessDateOnly = (now = new Date()) => {
    assertValidDate(now, 'now');
    const parts = businessDateFormatter.formatToParts(now);
    const year = parts.find(part => part.type === 'year')?.value;
    const month = parts.find(part => part.type === 'month')?.value;
    const day = parts.find(part => part.type === 'day')?.value;
    if (!year || !month || !day)
        throw new Error('Unable to determine business calendar date');
    return `${year}-${month}-${day}`;
};
exports.getBusinessDateOnly = getBusinessDateOnly;
