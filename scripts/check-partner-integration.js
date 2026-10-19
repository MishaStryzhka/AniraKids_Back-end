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
      partner: { source: 'anirak' },
    };
    assert.equal(calculatePartnerBalance([], [base]).earned, 200);
    assert.equal(
      calculatePartnerBalance([], [{ ...base, studioBooked: true }]).earned,
      0
    );
    const rental = {
      reservationNumber: 'TEST',
      status: 'returned',
      subtotal: 800,
      deposit: 0,
      rentalMode: 'external',
      fittingCreditId: 'fit',
      partner: { source: 'partner' },
      paymentEntries: [
        { type: 'rental_received', amount: 800, recordedAt: new Date() },
      ],
    };
    assert.equal(
      calculatePartnerBalance(
        [rental],
        [{ ...base, partner: { source: 'partner' } }]
      ).earned,
      400,
      'fitting is included in 50 percent'
    );
    assert.equal(
      calculatePartnerBalance(
        [{ ...rental, partner: { source: 'anirak' } }],
        [base]
      ).earned,
      200,
      'own external client pays fixed fitting fee'
    );
    assert.equal(
      calculatePartnerBalance(
        [{ ...rental, partner: { source: 'anirak' } }],
        [{ ...base, partner: { source: 'partner' } }]
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
            partner: { source: 'anirak' },
          },
        ],
        [base]
      ).earned,
      200,
      'an unconfirmed rental hold alone does not waive the completed fitting fee'
    );
    assert.equal(
      calculatePartnerBalance(
        [{ ...rental, rentalMode: 'studio', partner: { source: 'anirak' } }],
        [base]
      ).earned,
      0
    );
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
