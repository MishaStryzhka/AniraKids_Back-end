import type {HttpHandler} from '../types/http';
import {pushVapidConfig, registerOwnerPush, unregisterOwnerPush, validPushEndpoint} from '../services/admin-push.service';

export const adminPushHandler = (action: 'config' | 'subscribe' | 'unsubscribe'): HttpHandler =>
  async (req, res, next) => {
    res.setHeader?.('Cache-Control', 'private, no-store');
    if (!req.adminOwner || !req.authenticatedUserId) {
      return res.status(403).json({error: {code: 'ADMIN_FORBIDDEN', message: 'Owner access required'}});
    }
    try {
      const config = pushVapidConfig();
      if (action === 'config') return res.status(200).json({enabled: config.enabled, publicKey: config.publicKey});
      if (!config.enabled) return res.status(503).json({error: {code: 'PUSH_NOT_CONFIGURED'}});
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).length !== 1 || !validPushEndpoint((body as {endpoint?: unknown}).endpoint)) {
        return res.status(400).json({error: {code: 'INVALID_PUSH_ENDPOINT'}});
      }
      const endpoint = (body as {endpoint: string}).endpoint;
      if (action === 'subscribe') await registerOwnerPush(req.authenticatedUserId, endpoint);
      else await unregisterOwnerPush(req.authenticatedUserId, endpoint);
      return res.status(200).json({ok: true});
    } catch (error) {
      if (error instanceof Error && error.message === 'PUSH_DEVICE_LIMIT')
        return res.status(409).json({error: {code: 'PUSH_DEVICE_LIMIT'}});
      if (error instanceof Error && error.message === 'INVALID_PUSH_ENDPOINT')
        return res.status(400).json({error: {code: 'INVALID_PUSH_ENDPOINT'}});
      return next(error);
    }
  };
