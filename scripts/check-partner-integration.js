const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
module.exports = async function ({ request, models }) {
  const {
    PartnerModel,
    PartnerMemberModel,
  } = require('../build/v2/models/partner.model');
  const { FittingModel } = require('../build/v2/models/fitting.model');
  const {
    calculatePartnerBalance,
  } = require('../build/v2/services/partner-balance.service');
  const {
    issueReferral,
    resolveReferral,
  } = require('../build/v2/services/partner-referral.service');
  const { discountAdditionalDresses } = require('../build/v2/utils/pricing');
  const User = require('../models/user');
  const jwt = require('jsonwebtoken');
  const old = Object.fromEntries(
    ['SECRET_KEY', 'V2_ADMIN_USER_IDS', 'V2_ADMIN_API_ENABLED'].map(k => [
      k,
      process.env[k],
    ])
  );
  const ids = Array.from({ length: 4 }, () => new mongoose.Types.ObjectId());
  process.env.SECRET_KEY = 'owned-partner-integration-secret';
  process.env.V2_ADMIN_USER_IDS = String(ids[0]);
  process.env.V2_ADMIN_API_ENABLED = 'true';
  const tokens = ids.map(id =>
    jwt.sign({ id: String(id) }, process.env.SECRET_KEY)
  );
  for (const model of [PartnerModel, PartnerMemberModel, FittingModel]) {
    await model.createCollection();
    await model.createIndexes();
  }
  for (let i = 0; i < ids.length; i++)
    await User.collection.insertOne({
      _id: ids[i],
      email: `partner-${i}@example.test`,
      tokens: [{ token: tokens[i] }],
    });
  const call = (path, who = 0, body, key) =>
    request(path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + tokens[who],
        'Content-Type': 'application/json',
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  try {
    assert.equal((await call('/partner/access', 3)).status, 403);
    assert.equal(
      (await call('/partner/setup', 0, { enabled: true })).status,
      200
    );
    for (const [n, role] of [
      [1, 'administrator'],
      [2, 'photographer'],
    ])
      assert.equal(
        (
          await call('/partner/save-member', 0, {
            email: `partner-${n}@example.test`,
            role,
            active: true,
            revision: 0,
          })
        ).status,
        200
      );
    assert.equal(
      (
        await call('/partner/save-member', 1, {
          email: 'partner-3@example.test',
          role: 'administrator',
          active: true,
          revision: 0,
        })
      ).status,
      403
    );
    assert.equal((await call('/partner/balance', 2)).status, 403);
    assert.equal((await call('/partner/members', 2)).status, 403);
    const referral = await request('/referrals/blaze');
    assert.equal(referral.status, 200);
    assert.equal(
      (await resolveReferral(referral.body.token)).source,
      'partner'
    );
    await assert.rejects(() => resolveReferral(referral.body.token + 'x'), {
      code: 'INVALID_REFERRAL',
    });
    assert.equal(
      await resolveReferral(
        (await issueReferral('blaze', Date.now() - 31 * 86400000)).token
      ),
      undefined
    );
    const photographer = await call('/partner/access', 2);
    const personal = await request(
      '/referrals/' + photographer.body.referralCode
    );
    assert.equal(
      (await resolveReferral(personal.body.token)).staffId,
      String(ids[2])
    );
    const p = await models.ProductV2Model.create({
      name: 'Partner dress',
      description: 'Partner integration dress for isolated verification',
      slug: 'partner-integration-dress',
      status: 'active',
      category: 'dress',
      gender: 'girls',
      color: 'white',
      photos: [
        {
          url: 'https://example.test/partner.jpg',
          publicId: 'partner-test',
          alt: 'Partner dress',
        },
      ],
      rentalEnabled: true,
      rentalPrices: { studio: 600, external: 800 },
      defaultDeposit: 1000,
    });
    const v = await models.VariantV2Model.create({
      productId: p._id,
      size: '110',
    });
    await models.InventoryItemV2Model.create([
      {
        variantId: v._id,
        internalCode: 'PARTNER-ONE',
        status: 'active',
        condition: 'good',
      },
      {
        variantId: v._id,
        internalCode: 'PARTNER-TWO',
        status: 'active',
        condition: 'good',
      },
    ]);
    const date = new Date(Date.now() + 160 * 86400000)
      .toISOString()
      .slice(0, 10);
    const body = {
      items: [
        { productId: String(p._id), variantId: String(v._id) },
        { productId: String(p._id), variantId: String(v._id) },
      ],
      rentalMode: 'studio',
      startDate: date,
      endDate: date,
      customer: {
        firstName: 'Test',
        lastName: 'Partner',
        email: 'rental-partner@example.test',
        phone: '+420123456789',
      },
    };
    const key = randomUUID();
    const created = await call('/partner/create-reservation', 2, body, key);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.subtotal, 1080);
    assert.equal(created.body.deposit, 0);
    assert.equal(
      (await call('/partner/create-reservation', 2, body, key)).status,
      200
    );
    assert.equal(
      (await call('/partner/create-reservation', 1, body, key)).status,
      409,
      'cross-account replay denied'
    );
    const month = date.slice(0, 7);
    assert.equal(
      (await call('/partner/reservations?month=' + month, 2)).body.items.length,
      1
    );
    const r = await models.ReservationV2Model.findById(created.body.id).lean();
    assert.equal(r.partner.staffId, String(ids[2]));
    assert.equal(
      (
        await call('/partner/reservations/' + r._id, 2, {
          action: 'payment',
          payment: {},
        })
      ).status,
      403
    );
    assert.equal(
      (
        await call('/partner/reservations/' + r._id, 1, {
          action: 'payment',
          payment: {
            operationId: randomUUID(),
            expectedRevision: 0,
            type: 'rental_received',
            amount: 1080,
            method: 'bank_transfer',
          },
        })
      ).status,
      403
    );
    const unpaidConfirmation = await call('/partner/reservations/' + r._id, 1, { action: 'confirm' });
    assert.equal(unpaidConfirmation.status, 409);
    assert.equal(unpaidConfirmation.body.error.code, 'PAYMENT_ADVANCE_REQUIRED');
    assert.match(unpaidConfirmation.body.error.requestId, /^[a-f0-9-]{36}$/);
    assert.equal((await models.ReservationV2Model.findById(r._id).lean()).status, 'pending');
    const { reservationAdminService } = require('../build/v2/services/reservation-admin.service');
    const originalConfirm = reservationAdminService.confirm;
    const originalError = console.error;
    const capturedErrors = [];
    try {
      reservationAdminService.confirm = async () => { throw new Error('private-customer-data'); };
      console.error = (...args) => capturedErrors.push(args);
      const failed = await call('/partner/reservations/' + r._id, 1, { action: 'confirm' });
      assert.equal(failed.status, 500);
      assert.equal(failed.body.error.code, 'INTERNAL_ERROR');
      assert.equal(failed.body.error.message, 'Partner operation failed');
      assert.equal(capturedErrors[0][1].requestId, failed.body.error.requestId);
      assert.ok(!JSON.stringify([failed.body, capturedErrors]).includes('private-customer-data'));
    } finally {
      reservationAdminService.confirm = originalConfirm;
      console.error = originalError;
    }
    const cash = {
      operationId: randomUUID(),
      expectedRevision: 0,
      type: 'rental_received',
      amount: 1080,
      method: 'cash',
    };
    assert.equal(
      (
        await call('/partner/reservations/' + r._id, 1, {
          action: 'payment',
          payment: cash,
        })
      ).status,
      200
    );
    assert.equal(
      (
        await call('/partner/reservations/' + r._id, 1, {
          action: 'payment',
          payment: cash,
        })
      ).status,
      200
    );
    for (const action of ['confirm', 'prepare', 'rent', 'return'])
      assert.equal(
        (await call('/partner/reservations/' + r._id, 1, { action })).status,
        200,
        action
      );
    const balance = (await call('/partner/balance', 1)).body;
    assert.equal(balance.earned, 540);
    assert.equal(balance.collected, 1080);
    assert.equal(balance.balance, -540);
    const operationId = randomUUID();
    const settlement = {
      operationId,
      amount: 540,
      direction: 'to_anirak',
      note: 'Fixture transfer',
      revision: 0,
    };
    assert.equal((await call('/partner/settle', 1, settlement)).status, 403);
    assert.equal((await call('/partner/settle', 0, settlement)).status, 200);
    assert.equal((await call('/partner/settle', 0, settlement)).status, 200);
    assert.equal((await call('/partner/balance', 0)).body.balance, 0);
    await call('/partner/reservations/' + r._id, 1, {
      action: 'assign',
      userId: String(ids[1]),
    });
    assert.equal(
      (await call('/partner/reservations?month=' + month, 2)).body.items.length,
      0
    );
    assert.equal(
      (await call('/partner/reservations/' + r._id, 2, { action: 'return' }))
        .status,
      404
    );
    const publicDate = new Date(Date.now() + 165 * 86400000)
      .toISOString()
      .slice(0, 10);
    const publicBooking = await request('/reservations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({
        ...body,
        items: [body.items[0]],
        startDate: publicDate,
        endDate: publicDate,
        referralToken: personal.body.token,
      }),
    });
    assert.equal(publicBooking.status, 201, JSON.stringify(publicBooking.body));
    const publicRecord = await models.ReservationV2Model.findOne({
      reservationNumber: publicBooking.body.reservation.reservationNumber,
    }).lean();
    assert.equal(publicRecord.partner.staffId, String(ids[2]));
    assert.equal(publicRecord.partner.source, 'partner');
    const fitting = await FittingModel.create({
      operationId: randomUUID(),
      requestHash: 'fixture',
      tokenHash: 'fixture',
      number: 'ZK-012345ABCDEF',
      date: publicDate,
      time: '10:00',
      startAt: new Date(),
      address: 'Fixture',
      status: 'completed',
      paymentStatus: 'paid',
      customer: {
        name: 'Test Partner',
        email: body.customer.email,
        phone: body.customer.phone,
      },
      creditOperationId: randomUUID(),
      partner: { partnerId: 'blaze', source: 'anirak' },
      revision: 0,
    });
    const retired = await call('/partner/fittings/' + fitting._id, 0, {
      action: 'studio-booked', revision: 0, studioBooked: true, reference: 'EXT-123',
    });
    assert.equal(retired.status, 400, 'external studio confirmation is retired');
    assert.equal((await FittingModel.findById(fitting._id).lean()).studioBooked, false);
    const { actOnFitting } = require('../build/v2/services/fitting.service');
    await actOnFitting(
      String(fitting._id),
      {
        action: 'credit',
        revision: 0,
        reservationNumber: publicRecord.reservationNumber,
      },
      'owner:' + ids[0]
    );
    await actOnFitting(
      String(fitting._id),
      {
        action: 'credit',
        revision: 0,
        reservationNumber: publicRecord.reservationNumber,
      },
      'owner:' + ids[0]
    );
    const creditedRecord = await models.ReservationV2Model.findById(
      publicRecord._id
    ).lean();
    assert.equal(
      creditedRecord.partner.source,
      'anirak',
      'original fitting source is inherited'
    );
    assert.equal(creditedRecord.fittingCreditId, String(fitting._id));
    assert.equal(
      creditedRecord.paymentEntries.length,
      0,
      'fitting discount never creates a payment'
    );
    assert.equal(creditedRecord.fittingDiscount.amount, 200);
    const base = {
      _id: 'fit',
      number: 'ZK-EXAMPLE',
      status: 'completed',
      paymentStatus: 'paid',
      partner: { partnerId: 'blaze', source: 'anirak' },
    };
    assert.equal(calculatePartnerBalance([], [base]).earned, 200);
    assert.equal(
      calculatePartnerBalance([], [{ ...base, studioBooked: true }]).earned,
      200
    );
    const rental = {
      reservationNumber: 'TEST',
      status: 'returned',
      subtotal: 800,
      deposit: 0,
      rentalMode: 'external',
      fittingCreditId: 'fit',
      partner: { partnerId: 'blaze', source: 'partner' },
      paymentEntries: [
        { type: 'rental_received', amount: 800, recordedAt: new Date() },
      ],
    };
    assert.equal(
      calculatePartnerBalance(
        [rental],
        [{ ...base, partner: { partnerId: 'blaze', source: 'partner' } }]
      ).earned,
      600,
      'external partner rental retains the separate fitting fee'
    );
    assert.equal(
      calculatePartnerBalance(
        [{ ...rental, partner: { partnerId: 'blaze', source: 'anirak' } }],
        [base]
      ).earned,
      200,
      'own external client pays fixed fitting fee'
    );
    assert.equal(
      calculatePartnerBalance(
        [{ ...rental, partner: { partnerId: 'blaze', source: 'anirak' } }],
        [{ ...base, partner: { partnerId: 'blaze', source: 'partner' } }]
      ).earned,
      200,
      'owner source correction takes precedence over inherited fitting source'
    );
    assert.equal(
      calculatePartnerBalance(
        [
          {
            ...rental,
            status: 'pending',
            rentalMode: 'studio',
            partner: { partnerId: 'blaze', source: 'anirak' },
          },
        ],
        [base]
      ).earned,
      200,
      'an unconfirmed rental hold alone does not waive the completed fitting fee'
    );
    assert.equal(
      calculatePartnerBalance(
        [{ ...rental, rentalMode: 'studio', partner: { partnerId: 'blaze', source: 'anirak' } }],
        [base]
      ).earned,
      0
    );
    for (const source of ['anirak', 'partner']) {
      for (const mode of ['external', 'studio']) {
        for (const status of ['pending', 'confirmed', 'prepared', 'rented', 'returned', 'cancelled', 'expired']) {
          const linked = { ...rental, rentalMode: mode, status, partner: { partnerId: 'blaze', source } };
          const line = calculatePartnerBalance([linked], [base]).lines.find(l => l.kind === 'fitting');
          const waived = mode === 'studio' && ['confirmed', 'prepared', 'rented', 'returned'].includes(status);
          assert.equal(line.amount, waived ? 0 : 200, `${source} ${mode} ${status} fitting fee`);
        }
      }
    }
    for (const patch of [
      { fittingCreditId: 'another-fitting' },
      { partner: { partnerId: 'another-studio', source: 'partner' } },
      { partner: undefined },
    ]) {
      const linked = { ...rental, status: 'confirmed', rentalMode: 'studio', ...patch };
      assert.equal(calculatePartnerBalance([linked], [base]).lines.find(l => l.kind === 'fitting').amount, 200, 'only same Blaze fitting link waives fee');
    }
    for (const patch of [{ status: 'confirmed' }, { paymentStatus: 'unpaid' }, { paymentStatus: 'refunded' }]) {
      assert.equal(calculatePartnerBalance([], [{ ...base, ...patch }]).earned, 0, 'only completed paid fitting earns fee');
    }
    assert.deepEqual(
      discountAdditionalDresses([
        {
          product: { category: 'dress' },
          pricing: { rentalPrice: 500, deposit: 1000 },
        },
        {
          product: { category: 'dress' },
          pricing: { rentalPrice: 700, deposit: 1000 },
        },
        {
          product: { category: 'suit' },
          pricing: { rentalPrice: 900, deposit: 1000 },
        },
      ]).map(i => i.pricing.rentalPrice),
      [400, 700, 900]
    );
    assert.equal(
      (
        await call('/partner/save-member', 0, {
          email: 'partner-2@example.test',
          role: 'photographer',
          active: false,
          revision: 1,
        })
      ).status,
      200
    );
    assert.equal((await call('/partner/access', 2)).status, 403);
    assert.equal(await resolveReferral(personal.body.token), undefined);
    console.log(
      'PARTNER_INTEGRATION=PASS scopes referrals expiry revocation discount cash idempotency balance settlements'
    );
  } finally {
    await User.collection.deleteMany({ _id: { $in: ids } });
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
};
