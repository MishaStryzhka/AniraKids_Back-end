import type {HttpHandler} from '../types/http';
import {getSiteSettings, parseSiteSettingsPatch, patchSiteSettings} from '../services/site-settings.service';
export const readSiteSettings: HttpHandler = async (_request, response, next) => {
  try {
    response.setHeader?.('Cache-Control', 'no-store');
    return response.status(200).json(await getSiteSettings());
  } catch (error) {return next(error);}
};
export const updateSiteSettings: HttpHandler = async (request, response, next) => {
  const sections = parseSiteSettingsPatch(request.body);
  if (!sections) return response.status(400).json({error: {code: 'VALIDATION_ERROR', message: 'Neplatné nastavení sekcí.'}});
  try {
    response.setHeader?.('Cache-Control', 'no-store');
    return response.status(200).json(await patchSiteSettings(sections.sections, sections.filters));
  } catch (error) {return next(error);}
};
