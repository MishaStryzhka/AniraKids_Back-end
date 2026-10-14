/** Numeric labels enumerate sizes; letter ranges include intermediate sizes. */
export const LETTER_SIZES = ['XXXS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '4XL', '5XL'];
const letters = `(?:${LETTER_SIZES.join('|')})`;
const numericPattern = '^\\d{1,3}(?:\\s*[-–—/,]\\s*\\d{1,3})*$';
const letterRangePattern = `^${letters}(?:\\s*[-–—]\\s*${letters})+$`;
const letterListPattern = `^${letters}(?:\\s*[,/]\\s*${letters})*$`;

export function compareSizes(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) return Number(a) - Number(b);
  const ai = LETTER_SIZES.indexOf(a), bi = LETTER_SIZES.indexOf(b);
  if (ai >= 0 && bi >= 0) return ai - bi;
  return a.localeCompare(b, 'cs', { numeric: true });
}
export const normalizeFitSizes = (sizes: string[]): string[] =>
  Array.from(new Set(sizes.map(size => size.trim().toUpperCase()))).sort(compareSizes);

export function inferFitSizes(size: string): string[] {
  const label = size.trim().toUpperCase();
  if (new RegExp(numericPattern).test(label)) return normalizeFitSizes((label.match(/\d+/g) || []).map(value => String(Number(value))));
  if (new RegExp(letterRangePattern).test(label)) {
    const indices = label.split(/\s*[-–—]\s*/).map(value => LETTER_SIZES.indexOf(value));
    return LETTER_SIZES.slice(Math.min(...indices), Math.max(...indices) + 1);
  }
  if (new RegExp(letterListPattern).test(label)) return normalizeFitSizes(label.split(/\s*[,/]\s*/));
  // Preserve custom legacy labels rather than guessing what they mean.
  return [label];
}
export const effectiveFitSizes = (variant: { size: string; fitSizes?: string[] }): string[] =>
  variant.fitSizes === undefined ? inferFitSizes(variant.size) : normalizeFitSizes(variant.fitSizes);

// Database-side legacy fallback keeps filtering, counts and pagination consistent.
// No data migration or server-side JavaScript is needed.
export const fitSizesExpression = {
  $ifNull: ['$fitSizes', { $let: {
    vars: { label: { $toUpper: { $trim: { input: '$size' } } } },
    in: { $switch: {
      branches: [
        { case: { $regexMatch: { input: '$$label', regex: numericPattern } }, then: {
          $setUnion: [{ $map: { input: { $regexFindAll: { input: '$$label', regex: '[0-9]+' } }, as: 'part', in: { $toString: { $toInt: '$$part.match' } } } }, []],
        } },
        { case: { $regexMatch: { input: '$$label', regex: letterRangePattern } }, then: { $let: {
          vars: { indices: { $map: { input: { $regexFindAll: { input: '$$label', regex: letters } }, as: 'part', in: { $indexOfArray: [LETTER_SIZES, '$$part.match'] } } } },
          in: { $slice: [LETTER_SIZES, { $min: '$$indices' }, { $add: [{ $subtract: [{ $max: '$$indices' }, { $min: '$$indices' }] }, 1] }] },
        } } },
        { case: { $regexMatch: { input: '$$label', regex: letterListPattern } }, then: {
          $setUnion: [{ $map: { input: { $regexFindAll: { input: '$$label', regex: letters } }, as: 'part', in: '$$part.match' } }, []],
        } },
      ],
      default: ['$$label'],
    } },
  } }],
};
