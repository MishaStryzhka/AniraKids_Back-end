const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const publicUser = require('../helpers/publicUser');
const source = fs.readFileSync(path.join(__dirname, '../controllers/auth/authBySeznam.js'), 'utf8');
async function run({ existing = false, agent, denied = false, email = 'test@example.invalid', code = 'test-code', redirect = 'https://anirakids.cz' } = {}) {
  let saved = false, created = false, output, status, calls = 0, queried;
  const user = { _id: 'test-user', tokens: [], _doc: { email, password: 'test-hash', token: 'old', tokens: ['other-session'] }, save: async options => { assert.equal(options.validateModifiedOnly, true); saved = true; } };
  const User = { findOne: async query => { queried = query; return existing || created ? user : null; }, create: async () => { created = true; return user; } };
  const axios = { post: async () => { calls++; if (denied) throw new Error('secret upstream content'); return { data: { access_token: 'provider-token', account_name: 'not-an-email' } }; }, get: async (_url, config) => { assert.equal(config.headers.Authorization, 'Bearer provider-token'); return { data: { email } }; } };
  const modules = { axios: { default: axios }, '../../models': { User }, jsonwebtoken: { sign: payload => { assert.equal(payload.id, 'test-user'); return 'app-token'; } }, '../../helpers': { HttpError: (status, message) => Object.assign(new Error(message), { status }) }, '../../helpers/publicUser': publicUser };
  const context = { require: name => modules[name], module: { exports: {} }, process: { env: { SECRET_KEY: 'test', SEZNAM_CLIENT_ID: 'test', SEZNAM_CLIENT_SECRET: 'test' } } };
  vm.runInNewContext(source, context);
  const response = { set: (key, value) => assert.equal(value, 'no-store'), status: value => { status = value; return response; }, json: value => { output = value; } };
  try { await context.module.exports({ body: { code, redirect_uri: redirect }, headers: { 'user-agent': agent } }, response); }
  catch (error) { return { error, calls, created }; }
  assert.equal(status, 201); assert.ok(saved); assert.equal(user.tokens.length, 1);
  assert.equal(output.user.password, undefined); assert.equal(output.user.token, undefined); assert.equal(output.user.tokens, undefined);
  assert.equal(queried.email || queried.seznamEmail, email.toLowerCase()); assert.equal(user.seznamEmail, email.toLowerCase()); assert.equal(output.token, 'app-token');
  return { created, output };
}
(async () => {
  // Use the real schema: old incomplete profiles must not block a session update.
  const RealUser = require('../models/user');
  const legacy = RealUser.hydrate({
    email: 'legacy@seznam.cz', provider: 'AniraKids', password: 'test-hash',
    firstName: '', lastName: '',
    bankAccount: { accountName: '', accountNumber: '', IBAN: '', swiftBIC: '' },
  });
  legacy.tokens.push({ token: 'new-session', device: { platform: 'test' } });
  await assert.rejects(legacy.validate(), error => !!error.errors['firstName']);
  await legacy.validate({ validateModifiedOnly: true });
  legacy.tokens[0].token = '';
  await assert.rejects(legacy.validate({ validateModifiedOnly: true }), error => !!error.errors['tokens.0.token']);
  await new RealUser({ email: 'new@seznam.cz', provider: 'seznam' }).validate();
  assert.equal((await run()).created, true);
  assert.equal((await run({ existing: true, agent: 'AgentWithoutParentheses' })).created, false);
  assert.equal((await run({ existing: true, agent: 'Mozilla/5.0 (Test)' })).output.user.userID, 'test-user');
  const denied = await run({ denied: true }); assert.equal(denied.error.status, 401); assert.ok(!denied.error.message.includes('secret')); assert.equal(denied.created, false);
  assert.equal((await run({ email: null })).error.status, 400);
  for (const input of [{ code: {} }, { redirect: 'https://attacker.invalid' }]) { const result = await run(input); assert.equal(result.error.status, 400); assert.equal(result.calls, 0); }
  console.log('PASS: Seznam first/existing login, safe user-agent parsing, official email, private-field exclusion, denied/missing identity, redirect/input validation');
})().catch(error => { console.error(error); process.exitCode = 1; });
