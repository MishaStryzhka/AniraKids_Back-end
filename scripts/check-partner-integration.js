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
    assert.equal((await call('/partner/cooperation',0,{active:false})).status,200);
    const {fittingLocation}=require('../build/v2/services/cooperation.service');
    const {resolveBookingPartner}=require('../build/v2/services/partner-referral.service');
    assert.equal((await fittingLocation()).address,'Kytlická 862/2, Praha');
    assert.equal(await resolveBookingPartner(),undefined);
    assert.equal((await call('/partner/create-fitting',0,{})).status,409);
    assert.equal((await call('/partner/cooperation',0,{active:true})).status,200);
    assert.equal((await fittingLocation()).address,'Plzeňská 782/112, 150 00 Praha');
    const cooperation=await PartnerModel.findById('blaze').lean();
    assert.equal(cooperation.cooperationAudit.at(-1).by,'owner:'+String(ids[0]));
    assert.equal(cooperation.cooperationAudit.at(-1).active,true);

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
    assert.equal((await call('/partner/cooperation',1,{active:false})).status,403);
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
    for(const role of [0,1,2])assert.equal((await call('/partner/reservations?month='+month,role)).body.items.find(item=>item.id===String(r._id)).paymentStatus,'unpaid');
    assert.equal(r.partner.staffId, String(ids[2]));
    assert.deepEqual(r.partnerAudit.map(e=>e.action), ['created']);
    assert.equal(r.partnerAudit[0].by, 'partner:'+ids[2]);
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
    for(const role of [0,1,2])assert.equal((await call('/partner/reservations?month='+month,role)).body.items.find(item=>item.id===String(r._id)).paymentStatus,'paid');
    const {InvoiceModel}=require('../build/v2/models/invoice.model');
    const partnerInvoice=await InvoiceModel.findOne({sourceKey:'reservation:'+r._id}).lean();
    assert.equal(partnerInvoice.email.status,'pending');
    const mailFixture=require('./fitting-email-fixture');
    assert.equal(mailFixture.messages.filter(m=>m.subject.includes(partnerInvoice.number)).length,0);
    for (const action of ['confirm', 'prepare', 'rent', 'return']) {
      const admin = ['prepare','return'].includes(action);
      const path = admin ? '/admin/reservations/'+r._id+'/'+action : '/partner/reservations/'+r._id;
      const payload = admin ? {} : {action};
      assert.equal((await call(path, admin ? 0 : 1, payload)).status,200,action);
      assert.equal((await call(path, admin ? 0 : 1, payload)).status,200,'replay '+action);
    }
    const combined=mailFixture.messages.filter(m=>m.subject.includes(partnerInvoice.number));
    assert.equal(combined.length,1);assert.match(combined[0].subject,/Pronájem potvrzen · Faktura/);
    const audited = await models.ReservationV2Model.findById(r._id).lean();
    assert.deepEqual(audited.partnerAudit.map(e=>e.action), ['created','rental_received','invoice_issued','confirm','prepare','rent','return']);
    for (const entry of audited.partnerAudit) {
      assert.ok(entry.at instanceof Date && Number.isFinite(entry.at.getTime()));
      assert.equal(entry.by, (['prepare','return'].includes(entry.action)?'owner:'+ids[0]:'partner:'+ids[entry.action==='created'?2:1]));
    }
    assert.equal(audited.partnerAudit[1].operationId, cash.operationId);
    assert.equal(audited.partnerAudit[1].amount,1080);
    assert.equal(audited.partnerAudit[1].method,'cash');
    const notes = () => request('/admin/reservations/'+r._id+'/notes', {method:'PATCH',headers:{Authorization:'Bearer '+tokens[0],'Content-Type':'application/json'},body:JSON.stringify({notes:'Audit fixture note'})});
    assert.equal((await notes()).status,200);
    assert.equal((await notes()).status,200);
    const detail=await call('/admin/reservations/'+r._id,0);
    assert.equal(detail.status,200);
    assert.equal(detail.body.history.filter(e=>e.action==='notes_updated').length,1);
    assert.equal(detail.body.history.at(-1).by,'owner:'+ids[0]);
    assert.equal((await call('/admin/reservations/'+r._id,2)).status,403);
    assert.ok(!JSON.stringify((await call('/partner/reservations?month='+month,2)).body).includes('partnerAudit'));
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
    for (const [patch, price, basis, rate, amount] of [
      [{}, 800, 800, 50, 400],
      [{subtotal: 600, fittingDiscount: {amount: 200}, paymentEntries: [{type:'rental_received',amount:600}]}, 800, 800, 50, 400],
      [{paymentEntries: [{type:'rental_received',amount:800},{type:'rental_refunded',amount:300}]}, 800, 500, 50, 250],
      [{status:'confirmed'}, 800, 800, 50, 0],
      [{partner:{partnerId:'blaze',source:'anirak'}}, 800, 800, 0, 200],
    ]) {
      const input = {...rental,...patch};
      input.paymentEntries = input.paymentEntries.map(e => ({...e,recordedAt:new Date()}));
      const line = calculatePartnerBalance([input], []).lines[0];
      assert.deepEqual([line.rentalPrice,line.rewardBasis,line.rewardRate,line.amount], [price,basis,rate,amount], 'rental reward breakdown matches actual accrual');
    }
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
      200
    );
    const own = {...rental, partner:{partnerId:'blaze',source:'anirak'}};
    for (const [fittings, deduction, amount] of [
      [[],0,200], [[base],200,0], [[{...base,paymentStatus:'unpaid'}],0,200],
      [[{...base,status:'confirmed'}],0,200], [[{...base,partner:{partnerId:'other'}}],0,200],
    ]) {
      const result=calculatePartnerBalance([own],fittings);
      const line=result.lines[0];
      assert.equal(line.rewardAmount,200);
      assert.equal(line.fittingDeduction,deduction);
      assert.equal(line.fittingNumber,deduction ? base.number : null);
      assert.equal(line.amount,amount);
    }
    for(const status of ['pending','confirmed','prepared','rented','cancelled','expired']) {
      assert.equal(calculatePartnerBalance([{...own,status}],[]).lines[0].amount,0,'fixed reward accrues only on return');
    }
    assert.equal(calculatePartnerBalance([{...own,paymentEntries:[]}],[]).earned,0,'unpaid rental earns no reward');
    assert.equal(calculatePartnerBalance([own],[base]).earned,200,'linked fitting reward counted only once');
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
    // Admin-created bookings are ANIRAK clients, never bookings owned by the operator.
    const {AdminAccessModel}=require('../build/v2/models/admin-access.model');
    await AdminAccessModel.create({_id:ids[3],permissions:['fittings'],revision:0});
    const adminDate=new Date(Date.now()+180*86400000).toISOString().slice(0,10);
    const adminBody={...body,startDate:adminDate,endDate:adminDate};
    const adminKey=randomUUID();
    assert.equal((await call('/admin/booking-catalogue',3)).status,403);
    const catalogue=await call('/admin/booking-catalogue',0);
    assert.equal(catalogue.status,200);assert.ok(catalogue.body.items.some(x=>x.id===String(p._id)&&x.variants.some(y=>y.id===String(v._id))));
    assert.equal((await call('/admin/reservations',3,adminBody,adminKey)).status,403);
    const adminCreated=await call('/admin/reservations',0,adminBody,adminKey);
    assert.equal(adminCreated.status,201,JSON.stringify(adminCreated.body));
    assert.equal((await call('/admin/reservations',0,adminBody,adminKey)).body.id,adminCreated.body.id);
    assert.equal((await call('/admin/reservations',0,{...adminBody,auditActor:'spoofed'},randomUUID())).status,400);
    const adminRecord=await models.ReservationV2Model.findById(adminCreated.body.id).lean();
    assert.equal(adminRecord.customerId,undefined);assert.equal(adminRecord.partner.source,'anirak');
    assert.equal(adminRecord.partnerAudit[0].by,'owner:'+ids[0]);assert.equal(adminRecord.partnerAudit.filter(e=>e.action==='created').length,1);
    const {saveFittingSettings}=require('../build/v2/services/fitting-settings.service');
    await saveFittingSettings({enabled:true,address:'Admin fixture 12, Praha',weekly:Array.from({length:7},(_,day)=>({day,enabled:true,start:'09:00',end:'17:00'})),blockedDates:[]});
    const fittingBody={operationId:randomUUID(),token:'e'.repeat(64),date:new Date(Date.now()+7*86400000).toISOString().slice(0,10),time:'12:00',name:'Admin client',email:'admin-client@example.test',phone:'+420123456789'};
    const adminFitting=await call('/admin/fittings',3,fittingBody);
    assert.equal(adminFitting.status,201,JSON.stringify(adminFitting.body));
    assert.equal((await call('/admin/fittings',3,fittingBody)).body.number,adminFitting.body.number);
    assert.equal((await call('/admin/fittings',0,fittingBody)).status,409,'another admin cannot replay a saved client submission');
    const fittingRecord=await FittingModel.findOne({number:adminFitting.body.number}).lean();
    assert.equal(fittingRecord.customerId,undefined);assert.equal(fittingRecord.partner.source,'anirak');assert.equal(fittingRecord.audit[0].by,'admin:'+ids[3]);
    await AdminAccessModel.deleteOne({_id:ids[3]});
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
