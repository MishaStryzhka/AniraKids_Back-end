import {model, models, Schema, type Model} from 'mongoose';
import Joi = require('joi');

export interface SiteSections { suits: boolean; familyLooks: boolean; }
interface SiteSettingsDocument { _id: string; sections?: Partial<SiteSections>; }
export const DEFAULT_SITE_SECTIONS: SiteSections = {suits: true, familyLooks: false};
export const SITE_SETTINGS_ID = 'storefront';
const schema = new Schema<SiteSettingsDocument>({
  _id: {type: String, required: true},
  sections: {suits: Boolean, familyLooks: Boolean},
}, {collection: 'v2_site_settings', timestamps: true, strict: 'throw'});
export const SiteSettingsModel: Model<SiteSettingsDocument> =
  (models.SiteSettings as Model<SiteSettingsDocument> | undefined) ?? model<SiteSettingsDocument>('SiteSettings', schema);
const patchSchema = Joi.object({
  sections: Joi.object({suits: Joi.boolean().strict(), familyLooks: Joi.boolean().strict()}).min(1).required().unknown(false),
}).required().unknown(false);
export function parseSiteSettingsPatch(body: unknown): Partial<SiteSections> | null {
  const result = patchSchema.validate(body);
  return result.error ? null : result.value.sections;
}
function project(document: SiteSettingsDocument | null) {
  return {sections: {
    suits: document?.sections?.suits ?? DEFAULT_SITE_SECTIONS.suits,
    familyLooks: document?.sections?.familyLooks ?? DEFAULT_SITE_SECTIONS.familyLooks,
  }};
}
export async function getSiteSettings() {
  return project(await SiteSettingsModel.findById(SITE_SETTINGS_ID).lean().exec());
}
export async function patchSiteSettings(sections: Partial<SiteSections>) {
  const $set: Record<string, boolean> = {};
  for (const key of ['suits', 'familyLooks'] as const) {
    if (typeof sections[key] === 'boolean') $set['sections.' + key] = sections[key]!;
  }
  const write = () => SiteSettingsModel.findOneAndUpdate({_id: SITE_SETTINGS_ID}, {$set},
    {upsert: true, new: true, runValidators: true, setDefaultsOnInsert: false}).lean().exec();
  try { return project(await write()); }
  catch (error) {
    // Concurrent first saves may race on the singleton ID. Retry only known no-commit duplicates.
    if ((error as {code?: number}).code === 11000) return project(await write());
    throw error;
  }
}
