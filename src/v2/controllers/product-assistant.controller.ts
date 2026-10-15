import type {HttpHandler} from '../types/http';
import {toAdminProductDto} from '../http/admin-response';
import * as service from '../services/product-assistant.service';
export const productAssistantHandler = (action: 'create'|'sign'|'complete'|'remove'|'suggest'|'save'): HttpHandler => async (req,res,next) => {
  try {
    const owner = req.authenticatedUserId;
    if (!owner) return res.status(401).json({error: {code: 'ADMIN_UNAUTHORIZED', message: 'Přihlaste se.'}});
    const id = req.params?.draftId || '';
    const body = req.body as any;
    if (action === 'create') return res.status(201).json({draftId: await service.createProductDraft(owner)});
    if (action === 'sign') return res.status(200).json({upload: await service.signDraftPhoto(id, owner)});
    if (action === 'suggest') return res.status(200).json({suggestion: await service.suggestProduct(id, owner)});
    if (action === 'save') return res.status(201).json({product: toAdminProductDto(await service.saveProductDraft(id, owner, body))});
    if (typeof body?.publicId !== 'string' || body.publicId.length > 300) return res.status(400).json({error: {code: 'VALIDATION_ERROR', message: 'Neplatná fotografie.'}});
    const photos = action === 'complete' ? await service.completeDraftPhoto(id, owner, body.publicId) : await service.removeDraftPhoto(id, owner, body.publicId);
    return res.status(200).json({photos});
  } catch (error) {
    if (error instanceof service.ProductAssistantError) return res.status(error.status).json({error: {code: error.code, message: error.message}});
    return next(error);
  }
};
