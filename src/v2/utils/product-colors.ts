/** Commas separate colors; spaces belong to a shade name. */
export const colorKey = (value: string): string => value.trim().toLowerCase();
export const colorLabel = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
// Mongo's case conversion is ASCII-only. Map Czech capitals explicitly first.
const upper = 'ÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ';
const lower = 'áčďéěíňóřšťúůýž';
let lowercase: unknown = { $trim: { input: '$$part' } };
for (let i = 0; i < upper.length; i++) {
  lowercase = { $replaceAll: { input: lowercase, find: upper[i], replacement: lower[i] } };
}
export const colorKeysExpression = {
  $setUnion: [{ $filter: {
    input: { $map: { input: { $split: [{ $ifNull: ['$color', ''] }, ','] }, as: 'part', in: { $toLower: lowercase } } },
    as: 'key', cond: { $ne: ['$$key', ''] },
  } }, []],
};
