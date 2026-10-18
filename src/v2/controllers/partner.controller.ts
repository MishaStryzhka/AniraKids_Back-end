import { AdminAccessModel } from '../models/admin-access.model';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import type { HttpHandler, HttpRequest } from '../types/http';
import {
  authenticateLegacyBearer,
  parseBearerAuthorization,
} from '../auth/legacy-bearer';
import { getAdminOwnerIds } from '../middleware/admin.middleware';
import { PartnerModel, PartnerMemberModel } from '../models/partner.model';
import {
  ReservationV2Model,
  ProductV2Model,
  VariantV2Model,
  InventoryItemV2Model,
} from '../models';
import { FittingModel } from '../models/fitting.model';
import {
  PartnerError,
  issueReferral,
} from '../services/partner-referral.service';
import { partnerBalance } from '../services/partner-balance.service';
import {
  paymentSummary,
  publicPaymentSummary,
  parsePaymentInput,
  recordPayment,
} from '../services/payment.service';
import { PaymentError } from '../services/payment.types';
import { reservationService } from '../services/reservation.service';
import { ReservationServiceError } from '../services/reservation.types';
import { mapReservationApiError } from '../http/error-mapper';
import { reservationAdminService } from '../services/reservation-admin.service';
import { validateReservationRequestBody } from '../schemas/reservation.schema';
import {
  hashIdempotencyKey,
  hashReservationFingerprint,
  deriveIdempotentGuestAccessToken,
  isCanonicalUuidV4,
} from '../utils/idempotency';
import {
  createFitting,
  actOnFitting,
  publicFitting,
  FittingError,
} from '../services/fitting.service';
const User = require('../../../models/user');
export type PartnerAccess = {
  userId: string;
  owner: boolean;
  managePartners?: boolean;
  role: 'administrator' | 'photographer';
  partnerId: string;
};
export function partnerScope(access: PartnerAccess) {
  return {
    'partner.partnerId': access.partnerId,
    ...(access.role === 'photographer'
      ? { 'partner.staffId': access.userId }
      : {}),
  };
}
async function accessFor(req: HttpRequest): Promise<PartnerAccess> {
  const header = parseBearerAuthorization(
    req.headers.authorization ?? req.headers.Authorization
  );
  const identity =
    header.kind === 'bearer'
      ? await authenticateLegacyBearer(header.token)
      : null;
  if (!identity) throw new PartnerError('UNAUTHORIZED', 401);
  const userId = String(identity.userId),
    owner = (await getAdminOwnerIds()).has(userId);
  if (owner)
    return { userId, owner: true, role: 'administrator', partnerId: 'blaze' };
  const grant = await AdminAccessModel.findById(identity.userId).select('permissions').lean().exec();
  if (grant?.permissions?.includes('partners'))
    return { userId, owner: false, managePartners: true, role: 'administrator', partnerId: 'blaze' };
  const member = (await PartnerMemberModel.findOne({
    userId: identity.userId,
    partnerId: 'blaze',
    active: true,
  })
    .lean()
    .exec()) as any;
  if (!member || !(await PartnerModel.exists({ _id: 'blaze', enabled: true })))
    throw new PartnerError('FORBIDDEN', 403);
  return { userId, owner: false, role: member.role, partnerId: 'blaze' };
}
const id = (v: unknown) => {
  if (typeof v !== 'string' || !/^[a-f\d]{24}$/i.test(v))
    throw new PartnerError('VALIDATION_ERROR');
  return new Types.ObjectId(v);
};
const requirePartnerAdmin = (a: PartnerAccess) => {
  if (!a.owner && !a.managePartners) throw new PartnerError('FORBIDDEN', 403);
};
const requireManager = (a: PartnerAccess) => {
  if (a.role !== 'administrator') throw new PartnerError('FORBIDDEN', 403);
};
function range(req: HttpRequest) {
  const month = String(
    req.query?.month || new Date().toISOString().slice(0, 7)
  );
  if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(month))
    throw new PartnerError('VALIDATION_ERROR');
  return {
    from: month + '-01',
    to: new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)
    )
      .toISOString()
      .slice(0, 10),
  };
}
function reservationView(r: any, manager: boolean) {
  return {
    id: String(r._id),
    number: r.reservationNumber,
    status: r.status,
    startDate: r.startDate,
    endDate: r.endDate,
    rentalMode: r.rentalMode,
    customer: r.customerSnapshot,
    items: r.items.map((i: any) => ({
      productId: String(i.productId),
      inventoryItemId: String(i.inventoryItemId),
      name: i.productNameSnapshot,
      size: i.sizeSnapshot,
      rentalPrice: i.rentalPriceSnapshot,
    })),
    subtotal: r.subtotal,
    deposit: r.deposit,
    source: r.partner?.source,
    staffId: r.partner?.staffId,
    notes: r.notes,
    payment: manager
      ? paymentSummary(r)
      : {
          rentalBalance: paymentSummary(r).rentalBalance,
          depositRequired: r.deposit,
        },
    instructions: publicPaymentSummary(r),
  };
}
export function partnerHandler(action: string): HttpHandler {
  return async (req, res, next) => {
    res.setHeader?.('Cache-Control', 'private, no-store');
    res.setHeader?.('Vary', 'Authorization');
    try {
      if (action === 'referral')
        return res
          .status(200)
          .json(await issueReferral(String(req.params?.code || '')));
      const access = await accessFor(req),
        scope = partnerScope(access),
        body = (req.body || {}) as any;
      const actor = (access.owner ? 'owner:' : access.managePartners ? 'admin:' : 'partner:') + access.userId;
      if (action === 'access') {
        const partner = (await PartnerModel.findById(access.partnerId)
          .lean()
          .exec()) as any;
        const member = (await PartnerMemberModel.findOne({
          partnerId: access.partnerId,
          userId: access.userId,
        })
          .lean()
          .exec()) as any;
        return res.status(200).json({
          ...access,
          name: partner?.name || 'Blaze Photostudio',
          enabled: partner?.enabled === true,
          referralCode: member?.referralCode || 'blaze',
        });
      }
      if (action === 'setup') {
        requirePartnerAdmin(access);
        if (typeof body.enabled !== 'boolean')
          throw new PartnerError('VALIDATION_ERROR');
        await PartnerModel.updateOne(
          { _id: 'blaze' },
          {
            $set: { name: 'Blaze Photostudio', enabled: body.enabled },
            $setOnInsert: { revision: 0, settlements: [] },
          },
          { upsert: true }
        ).exec();
        return res.status(200).json({ ok: true });
      }
      if (action === 'members') {
        requireManager(access);
        const members = (await PartnerMemberModel.find({
          partnerId: access.partnerId,
        })
          .sort({ createdAt: 1 })
          .lean()
          .exec()) as any[];
        const users = await User.find({
          _id: { $in: members.map(m => m.userId) },
        })
          .select('email firstName lastName')
          .lean()
          .exec();
        return res.status(200).json({
          items: members.map(m => ({
            id: String(m.userId),
            email:
              users.find((u: any) => String(u._id) === String(m.userId))
                ?.email || '',
            role: m.role,
            active: m.active,
            referralCode: m.referralCode,
            revision: m.revision,
          })),
        });
      }
      if (action === 'save-member') {
        requirePartnerAdmin(access);
        if (
          typeof body.email !== 'string' ||
          body.email.length > 254 ||
          !['administrator', 'photographer'].includes(body.role) ||
          typeof body.active !== 'boolean' ||
          !Number.isSafeInteger(body.revision) ||
          body.revision < 0
        )
          throw new PartnerError('VALIDATION_ERROR');
        const user = await User.findOne({
          email: body.email.toLowerCase().trim(),
        })
          .select('_id')
          .lean()
          .exec();
        if (!user) throw new PartnerError('USER_NOT_FOUND', 404);
        const audit = {
          by: actor,
          at: new Date(),
          role: body.role,
          active: body.active,
        };
        if (body.revision === 0)
          await PartnerMemberModel.create({
            partnerId: 'blaze',
            userId: user._id,
            role: body.role,
            active: body.active,
            referralCode: 'blaze-' + randomUUID().slice(0, 8),
            audit: [audit],
          });
        else {
          const result = await PartnerMemberModel.updateOne(
            { partnerId: 'blaze', userId: user._id, revision: body.revision },
            {
              $set: { role: body.role, active: body.active },
              $inc: { revision: 1 },
              $push: { audit },
            }
          ).exec();
          if (!result.modifiedCount) throw new PartnerError('CONFLICT', 409);
        }
        return res.status(200).json({ ok: true });
      }
      if (action === 'balance') {
        requireManager(access);
        return res.status(200).json(await partnerBalance(access.partnerId));
      }
      if (action === 'settle') {
        requirePartnerAdmin(access);
        if (
          !isCanonicalUuidV4(body.operationId) ||
          typeof body.amount !== 'number' ||
          !Number.isFinite(body.amount) ||
          Math.abs(body.amount * 100 - Math.round(body.amount * 100)) >
            0.000001 ||
          body.amount < 0.01 ||
          body.amount > 1000000 ||
          !['to_partner', 'to_anirak'].includes(body.direction) ||
          typeof body.note !== 'string' ||
          body.note.trim().length < 3 ||
          body.note.length > 500 ||
          !Number.isSafeInteger(body.revision)
        )
          throw new PartnerError('VALIDATION_ERROR');
        const partner = (await PartnerModel.findById(access.partnerId)
          .lean()
          .exec()) as any;
        if (!partner) throw new PartnerError('PARTNER_NOT_FOUND', 404);
        const previous = partner.settlements.find(
          (s: any) => s.operationId === body.operationId
        );
        if (previous) {
          if (
            previous.amount !== body.amount ||
            previous.direction !== body.direction ||
            previous.note !== body.note
          )
            throw new PartnerError('CONFLICT', 409);
          return res.status(200).json({ ok: true });
        }
        const changed = await PartnerModel.updateOne(
          {
            _id: access.partnerId,
            revision: body.revision,
            'settlements.operationId': { $ne: body.operationId },
          },
          {
            $inc: { revision: 1 },
            $push: {
              settlements: {
                operationId: body.operationId,
                amount: body.amount,
                direction: body.direction,
                note: body.note,
                at: new Date(),
                by: actor,
              },
            },
          }
        ).exec();
        if (!changed.modifiedCount) throw new PartnerError('CONFLICT', 409);
        return res.status(200).json({ ok: true });
      }
      if (action === 'reservations') {
        const { from, to } = range(req);
        const docs = await ReservationV2Model.find({
          ...scope,
          startDate: { $lt: new Date(to) },
          endDate: { $gte: new Date(from) },
        })
          .sort({ startDate: 1 })
          .limit(501)
          .lean()
          .exec();
        return res.status(200).json({
          truncated: docs.length > 500,
          items: docs
            .slice(0, 500)
            .map(r => reservationView(r, access.role === 'administrator')),
        });
      }
      if (action === 'create-reservation') {
        const rawKey = req.headers['idempotency-key'];
        if (typeof rawKey !== 'string' || !isCanonicalUuidV4(rawKey))
          throw new PartnerError('INVALID_IDEMPOTENCY_KEY');
        const parsed = validateReservationRequestBody(body);
        if (!parsed.value) throw new PartnerError('VALIDATION_ERROR');
        const v = parsed.value;
        const result = await reservationService.createReservation(
          {
            productId: id(v.productId),
            variantId: id(v.variantId),
            ...(v.items
              ? {
                  items: v.items.map(i => ({
                    productId: id(i.productId),
                    variantId: id(i.variantId),
                  })),
                }
              : {}),
            rentalMode: v.rentalMode,
            startDate: v.startDate,
            endDate: v.endDate,
            customer: v.customer,
            notes: v.notes,
            partner: {
              partnerId: access.partnerId,
              source: 'partner',
              staffId: access.userId,
              createdBy: actor,
              version: 1,
            },
          },
          {
            idempotency: {
              keyHash: hashIdempotencyKey(rawKey),
              requestHash: hashReservationFingerprint({
                ...v,
                authenticatedUserId: access.userId,
              }),
              guestAccessToken: deriveIdempotentGuestAccessToken(rawKey),
            },
          }
        );
        if (result.reservation.partner?.createdBy !== actor)
          throw new PartnerError('CONFLICT', 409);
        return res
          .status(result.replayed ? 200 : 201)
          .json(
            reservationView(result.reservation, access.role === 'administrator')
          );
      }
      if (action === 'reservation-action') {
        const r = await ReservationV2Model.findOne({
          ...scope,
          _id: id(req.params?.id),
        })
          .lean()
          .exec();
        if (!r) throw new PartnerError('NOT_FOUND', 404);
        switch (body.action) {
          case 'confirm':
            requireManager(access);
            await reservationAdminService.confirm(r._id);
            break;
          case 'prepare':
            await reservationAdminService.prepare(r._id, actor);
            break;
          case 'rent':
            await reservationAdminService.rent(r._id, actor);
            break;
          case 'return':
            await reservationAdminService.returnReservation(r._id, actor);
            break;
          case 'payment': {
            requireManager(access);
            const input = parsePaymentInput(body.payment);
            if (
              !access.owner && !access.managePartners &&
              (input.method !== 'cash' ||
                ![
                  'advance_received',
                  'rental_received',
                  'deposit_received',
                  'deposit_refunded',
                ].includes(input.type))
            )
              throw new PartnerError('FORBIDDEN', 403);
            await recordPayment(r._id, input, actor);
            break;
          }
          case 'assign': {
            requireManager(access);
            const member = await PartnerMemberModel.exists({
              partnerId: access.partnerId,
              userId: id(body.userId),
              active: true,
            });
            if (!member) throw new PartnerError('USER_NOT_FOUND', 404);
            await ReservationV2Model.updateOne(
              { _id: r._id, 'partner.partnerId': access.partnerId },
              {
                $set: { 'partner.staffId': body.userId },
                $push: {
                  partnerAudit: {
                    action: 'assigned:' + body.userId,
                    at: new Date(),
                    by: actor,
                  },
                },
              }
            ).exec();
            break;
          }
          case 'source': {
            requirePartnerAdmin(access);
            if (
              !['anirak', 'partner'].includes(body.source) ||
              typeof body.reason !== 'string' ||
              body.reason.trim().length < 5 ||
              body.reason.length > 200
            )
              throw new PartnerError('VALIDATION_ERROR');
            await ReservationV2Model.updateOne(
              { _id: r._id },
              {
                $set: { 'partner.source': body.source },
                $push: {
                  partnerAudit: {
                    action: 'source:' + body.source + ':' + body.reason,
                    at: new Date(),
                    by: actor,
                  },
                },
              }
            ).exec();
            break;
          }
          default:
            throw new PartnerError('VALIDATION_ERROR');
        }
        return res.status(200).json({ ok: true });
      }
      if (action === 'fittings') {
        const { from, to } = range(req);
        const docs = (await FittingModel.find({
          ...scope,
          date: { $gte: from, $lt: to },
        })
          .sort({ createdAt: -1, _id: -1 })
          .limit(501)
          .lean()
          .exec()) as any[];
        return res.status(200).json({
          truncated: docs.length > 500,
          items: docs.slice(0, 500).map(d => ({
            ...publicFitting(d),
            id: String(d._id),
            customer: d.customer,
            revision: d.revision,
            studioBooked: d.studioBooked,
            studioBookingReference: d.studioBookingReference,
            source: d.partner?.source,
          })),
        });
      }
      if (action === 'create-fitting') {
        const result = await createFitting(body, new Date(), undefined, {
          partnerId: access.partnerId,
          source: 'partner',
          staffId: access.userId,
          createdBy: actor,
          version: 1,
        });
        return res.status(200).json(result);
      }
      if (action === 'fitting-action') {
        const f = (await FittingModel.findOne({
          ...scope,
          _id: id(req.params?.id),
        })
          .lean()
          .exec()) as any;
        if (!f) throw new PartnerError('NOT_FOUND', 404);
        if (body.action === 'studio-booked') {
          requireManager(access);
          if (
            typeof body.studioBooked !== 'boolean' ||
            typeof body.reference !== 'string' ||
            body.reference.length > 120 ||
            (body.studioBooked && !body.reference.trim())
          )
            throw new PartnerError('VALIDATION_ERROR');
          const changed = await FittingModel.updateOne(
            { _id: f._id, revision: body.revision },
            {
              $set: {
                studioBooked: body.studioBooked,
                studioBookingReference: body.reference,
              },
              $inc: { revision: 1 },
              $push: {
                audit: {
                  action: body.studioBooked
                    ? 'studio_booked'
                    : 'studio_booking_removed',
                  at: new Date(),
                  by: actor,
                },
              },
            }
          ).exec();
          if (!changed.modifiedCount) throw new PartnerError('CONFLICT', 409);
        } else {
          if (!access.owner && !access.managePartners && !['complete', 'credit'].includes(body.action))
            throw new PartnerError('FORBIDDEN', 403);
          if (body.action === 'credit') {
            const r = await ReservationV2Model.exists({
              ...scope,
              reservationNumber: body.reservationNumber,
            });
            if (!r) throw new PartnerError('NOT_FOUND', 404);
          }
          await actOnFitting(String(f._id), body, actor);
        }
        return res.status(200).json({ ok: true });
      }
      if (action === 'catalogue') {
        const products = await ProductV2Model.find({
          status: 'active',
          rentalEnabled: true,
        })
          .select('name slug photos rentalPrices')
          .sort({ name: 1 })
          .limit(500)
          .lean()
          .exec();
        const variants = await VariantV2Model.find({
          productId: { $in: products.map(p => p._id) },
          status: 'active',
        })
          .select('productId size')
          .lean()
          .exec();
        const pieces = await InventoryItemV2Model.find({
          variantId: { $in: variants.map(v => v._id) },
        })
          .select('variantId internalCode status condition')
          .lean()
          .exec();
        return res.status(200).json({
          items: products.map(p => ({
            id: String(p._id),
            name: p.name,
            slug: p.slug,
            photo: p.photos?.[0]?.url,
            variants: variants
              .filter(v => v.productId.equals(p._id))
              .map(v => ({
                id: String(v._id),
                size: v.size,
                pieces: pieces
                  .filter(i => i.variantId.equals(v._id))
                  .map(i => ({
                    id: String(i._id),
                    code: i.internalCode,
                    status: i.status,
                    condition: i.condition,
                  })),
              })),
          })),
        });
      }
      throw new PartnerError('NOT_FOUND', 404);
    } catch (e) {
      if (e instanceof ReservationServiceError) {
        const mapped = mapReservationApiError(e);
        return res.status(mapped.status).json(mapped.body);
      }
      if (
        e instanceof PartnerError ||
        e instanceof PaymentError ||
        e instanceof FittingError
      )
        return res
          .status(e.status)
          .json({ error: { code: e.code, message: e.code } });
      if ((e as any)?.code === 11000)
        return res
          .status(409)
          .json({ error: { code: 'CONFLICT', message: 'CONFLICT' } });
      return next(e);
    }
  };
}
