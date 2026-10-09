// Fresh loopback-only database. Never reads .env or accepts an external database URI.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const vm = require('node:vm');
const mongoose = require('mongoose');
const User = require('../models/user');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.PUBLIC_BOOKING_TEST_ALLOW, '1');
mongoose.set('strictQuery', true);
let child, directory;
const watchdog = setTimeout(() => { child?.kill('SIGKILL'); process.exit(1); }, 60000);
watchdog.unref();
process.env.SECRET_KEY = 'disposable-auth-test-secret';
const { createRequire } = require('node:module');
let messages = [];
function load(file) {
  const filename = path.join(__dirname, '..', file);
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, process, Buffer, require: name => {
    if (name === '../../models' || name === '../models') return { User };
    if (name === '../../helpers' || name === '../helpers' || name === '../../../helpers') return {
      HttpError: (status, message) => Object.assign(new Error(message), { status }),
      sendEmail: async message => { messages.push(message); },
    };
    return localRequire(name);
  } };
  context.exports = context.module.exports;
  vm.runInNewContext(readFileSync(filename, 'utf8'), context);
  return context.module.exports;
}
const register = load('controllers/auth/register.js');
const login = load('controllers/auth/login.js');
const authenticate = load('middlewares/authenticate.js');
const recovery = load('controllers/auth/passwordRecovery.js');
const verify = load('controllers/auth/verifiedEmail/verifiedEmail.js');
const confirm = load('controllers/auth/confirmEmail.js');
async function run(fn, req) {
  let output;
  const res = { set: () => {}, status: status => { assert.ok([200, 201].includes(status)); return res; }, json: value => { output = value; } };
  await fn(req, res); return output;
}
async function authorized(token) {
  let error;
  const req = { headers: { authorization: 'Bearer ' + token } };
  await authenticate(req, {}, value => { error = value; });
  if (error) throw error;
  return req.user;
}
(async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  directory = mkdtempSync(path.join(tmpdir(), 'anirakids-auth-completion-'));
  child = spawn(process.env.PUBLIC_BOOKING_MONGOD_BINARY || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', directory, '--nounixsocket'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => { output += data; if (output.includes('Waiting for connections')) resolve(); });
    child.stderr.on('data', () => {});
    child.once('error', reject); child.once('exit', code => reject(new Error('Owned Mongo exited: ' + code)));
  });
  await mongoose.connect(`mongodb://127.0.0.1:${port}/auth_fixture`);
  await User.init();
  const credentials = { email: 'fresh@seznam.cz', password: 'FixturePassword123' };
  const registered = await run(register, { body: credentials, headers: {} });
  const user = await authorized(registered.token);
  assert.equal(user.email, credentials.email);
  assert.equal(registered.user.password, undefined); assert.equal(registered.user.tokens, undefined);
  await assert.rejects(run(register, { body: credentials, headers: {} }), error => error.status === 409);
  await User.updateOne({ _id: user._id }, { $set: { firstName: '', lastName: '' } });
  const signed = await run(login, { body: { login: 'FRESH@SEZNAM.CZ', password: credentials.password }, headers: {} });
  await authorized(signed.token);
  await assert.rejects(run(login, { body: { login: credentials.email, password: 'wrong-password' }, headers: {} }), error => error.status === 401);
  const unknown = await run(recovery.request, { body: { email: 'unknown@seznam.cz' } });
  const known = await run(recovery.request, { body: { email: credentials.email } });
  assert.equal(unknown.message, known.message);
  assert.equal(messages.length, 1);
  await run(recovery.request, { body: { email: credentials.email } }); assert.equal(messages.length, 1);
  const resetToken = messages[0].text.match(/resetToken=([a-f0-9]{64})/)[1];
  assert.equal((await User.findById(user._id)).passwordReset, undefined);
  await run(recovery.confirm, { body: { token: resetToken, password: 'NewFixturePassword123' } });
  await assert.rejects(authorized(signed.token), error => error.status === 401);
  await assert.rejects(run(recovery.confirm, { body: { token: resetToken, password: 'OtherFixturePassword123' } }), error => error.status === 400);
  await assert.rejects(run(login, { body: { login: credentials.email, password: credentials.password }, headers: {} }), error => error.status === 401);
  const fresh = await run(login, { body: { login: credentials.email, password: 'NewFixturePassword123' }, headers: {} });
  const freshUser = await authorized(fresh.token);
  await run(verify, { user: freshUser });
  const verificationToken = messages.at(-1).text.match(/verifyToken=([a-f0-9]{64})/)[1];
  assert.ok(!messages.at(-1).text.includes(fresh.token));
  await assert.rejects(run(confirm, { body: { token: fresh.token } }), error => error.status === 400);
  const verified = await run(confirm, { body: { token: verificationToken } });
  assert.equal(verified.user.emailVerified, true);
  await assert.rejects(run(confirm, { body: { token: verificationToken } }), error => error.status === 400);
  await run(recovery.request, { body: { email: credentials.email } });
  const expired = messages.at(-1).text.match(/resetToken=([a-f0-9]{64})/)[1];
  await User.updateOne({ _id: user._id }, { $set: { 'passwordReset.expiresAt': new Date(0) } });
  await assert.rejects(run(recovery.confirm, { body: { token: expired, password: 'NotApplied123' } }), error => error.status === 400);
  console.log('PASS: registration session, reload authentication, normalized login, legacy profile, password hashing/recovery/replay/expiry/cooldown/session revocation, single-use email proof, private fields');

})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await stopped; }
  if (directory) rmSync(directory, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('CLEANUP: disposable database removed');
});
