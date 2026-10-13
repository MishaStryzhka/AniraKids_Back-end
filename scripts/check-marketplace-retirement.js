// Exercise the real Express mounting order without database or provider access.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const publicUser = require('../helpers/publicUser');
const User = require('../models/user');

async function main() {
  let databaseCalls = 0;
  const account = express.Router();
  account.use((_req, res) => res.status(200).json({ currentAccountRoute: true }));
  const context = { module: { exports: {} }, __dirname: path.join(__dirname, '..'), require: name => {
    if (name === 'dotenv') return { config() {} };
    if (name === 'morgan') return () => (_req, _res, next) => next();
    if (name === './config/mongodb') return { connectMongo: async () => { databaseCalls++; } };
    if (name === './routes/api/auth' || name === './routes/api/settings') return account;
    if (name === './routes/retiredMarketplace') return require('../routes/retiredMarketplace');
    if (name === './build/v2/http/cors') return { createV2CorsOptions: () => ({}) };
    if (name === './build/v2/routes') return { createV2Router: (_express, { ensureMongoConnection }) => {
      const router = express.Router();
      router.use(ensureMongoConnection, (_req, res) => res.json({ currentV2Route: true }));
      return router;
    } };
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);
  const server = context.module.exports.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const retired = [
      ['POST', '/api/product/addProduct'], ['PATCH', '/api/product/updateProduct/fixture'],
      ['GET', '/api/product/getCurrentUserProducts'], ['GET', '/api/product/getProducts'],
      ['GET', '/api/product/getProductById/fixture'], ['DELETE', '/api/product/fixture'],
      ['POST', '/api/order/add'], ['GET', '/api/order/get_orders'],
      ['PATCH', '/api/order/set_quantity'], ['PATCH', '/api/order/confirm_by_user/fixture'],
      ['DELETE', '/api/order/remove_orders'], ['PATCH', '/api/users/current/update-billing-details'],
      ['PATCH', '/api/users/current/update-bank-account'], ['PATCH', '/api/users/favorites/add/fixture'],
      ['DELETE', '/api/users/favorites/remove/fixture'], ['GET', '/api/users/user/fixture'],
      ['GET', '/api/internal/cron/update-abandoned-orders'],
    ];
    for (const [method, endpoint] of retired) {
      // An obsolete session must not re-enable a closed feature.
      for (const headers of [{}, { Authorization: 'Bearer obsolete-session' }]) {
        const response = await fetch(base + endpoint, { method, headers });
        assert.equal(response.status, 410, `${method} ${endpoint}`);
        assert.equal((await response.json()).code, 'MARKETPLACE_RETIRED');
      }
    }
    assert.equal(databaseCalls, 0, 'retired requests must not reach the database');
    for (const endpoint of ['/api/users/current', '/api/users/favorites/storefront', '/api/v2/catalogue', '/api/v2/admin/products', '/api/settings/language']) {
      assert.equal((await fetch(base + endpoint)).status, 200, endpoint);
    }
    assert.equal(databaseCalls, 5, 'current routes retain their database boundary');
    assert.equal((await fetch(base + '/api/products-unrelated')).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  const archived = User.hydrate({ _id: '507f1f77bcf86cd799439011', email: 'old@example.cz', provider: 'seznam',
    typeUser: 'owner', billingDetails: { name: '' }, bankAccount: { IBAN: 'historical' },
    rating: 5, ratingCount: 3, cart: [], pickupAddresses: [{ city: 'Historical' }] });
  archived.firstName = 'Customer';
  await archived.validate();
  const profile = publicUser(archived);
  for (const key of ['typeUser', 'billingDetails', 'bankAccount', 'rating', 'ratingCount', 'cart', 'pickupAddresses']) {
    assert.equal(profile[key], undefined, key);
    assert.equal(User.schema.path(key).options.select, false, key);
  }
  assert.equal(archived.toObject().bankAccount.IBAN, 'historical');
  assert.equal(profile.firstName, 'Customer');
  assert.equal(new User({ email: 'new@example.cz', provider: 'seznam' }).typeUser, undefined);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'))).crons, []);
  console.log('PASS: retired routes return 410 before database access; current route boundaries preserved; historical fields retained and excluded; no owner onboarding or cron');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
