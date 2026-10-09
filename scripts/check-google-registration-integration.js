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
const jwt = require('jsonwebtoken');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.PUBLIC_BOOKING_TEST_ALLOW, '1');
mongoose.set('strictQuery', true);
let child, directory;
const watchdog = setTimeout(() => { child?.kill('SIGKILL'); process.exit(1); }, 60000);
watchdog.unref();
async function signIn(email, sub = email, overrides = {}) {
  const identity = { sub, email, given_name: 'Li', family_name: 'Wu', email_verified: true, ...overrides };
  const context = { module: { exports: {} }, process: { env: { SECRET_KEY: 'local-test', GOOGLE_CLIENT_ID: 'fixture-client' } }, require: name => {
    if (name === '../../helpers/verifyGoogleCredential') return async (credential, audience) => { assert.equal(audience, 'fixture-client'); if (credential !== 'fixture') throw new Error('invalid'); return identity; };
    if (name === '../../models') return { User };
    if (name === '../../helpers') return { HttpError: (status, message) => Object.assign(new Error(message), { status }) };
    if (name === '../../helpers/publicUser') return require('../helpers/publicUser');
    return require(name);
  } };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../controllers/auth/authByGoogle.js'), 'utf8'), context);
  let output;
  const res = { set: (_, value) => assert.equal(value, 'no-store'), status: status => { assert.equal(status, 201); return res; }, json: body => { output = body; } };
  await context.module.exports({ body: { credential: overrides.credential || 'fixture' }, headers: {} }, res);
  assert.ok(output.token); assert.ok(output.user.userID);
  for (const key of ['password','token','tokens','googleId']) assert.equal(output.user[key], undefined);
  assert.equal(jwt.verify(output.token, 'local-test').id, output.user.userID);
  return output;
}
(async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  directory = mkdtempSync(path.join(tmpdir(), 'anirakids-google-registration-'));
  child = spawn(process.env.PUBLIC_BOOKING_MONGOD_BINARY || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', directory, '--nounixsocket'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => { output += data; if (output.includes('Waiting for connections')) resolve(); });
    child.stderr.on('data', () => {});
    child.once('error', reject); child.once('exit', code => reject(new Error('Owned Mongo exited: ' + code)));
  });
  await mongoose.connect(`mongodb://127.0.0.1:${port}/google_fixture`);
  await User.init();
  const first = await signIn('first@gmail.com');
  const second = await signIn('second@gmail.com');
  assert.notEqual(first.user.userID, second.user.userID);
  const again = await signIn('first@gmail.com');
  assert.equal(again.user.userID, first.user.userID);
  assert.equal(await User.countDocuments(), 2);
  const saved = await User.findById(first.user.userID);
  assert.equal(saved.tokens.length, 1);
  assert.ok(saved.tokens.some(item => item.token === again.token));
  // Actual middleware proves the returned session is usable after a fresh DB read.
  process.env.SECRET_KEY = 'local-test';
  const authContext = { module: { exports: {} }, process, require: name => {
    if (name === '../models') return { User };
    if (name === '../helpers') return { HttpError: status => Object.assign(new Error('unauthorized'), { status }) };
    return require(name);
  } };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../middlewares/authenticate.js'), 'utf8'), authContext);
  const req = { headers: { authorization: 'Bearer ' + again.token } };
  await authContext.module.exports(req, {}, error => { if (error) throw error; });
  assert.equal(String(req.user._id), first.user.userID);
  await User.collection.updateOne({ _id: saved._id }, { $set: { firstName: '', lastName: '' } });
  await signIn('first@gmail.com');
  const renamed = await signIn('new@gmail.com', 'first@gmail.com');
  assert.equal(renamed.user.userID, first.user.userID);
  await assert.rejects(signIn('first@gmail.com', 'different-sub'), error => error.status === 409);
  await User.create({ email: 'legacy@gmail.com', provider: 'seznam' });
  await signIn('legacy@gmail.com');
  await User.create({ email: 'legacy@example.cz', provider: 'seznam' });
  await assert.rejects(signIn('legacy@example.cz'), error => error.status === 409);
  await signIn('new@example.cz'); await signIn('new@example.cz');
  const concurrent = await Promise.all([signIn('race@gmail.com'), signIn('race@gmail.com')]);
  assert.equal(concurrent[0].user.userID, concurrent[1].user.userID);
  const before = await User.countDocuments();
  await assert.rejects(signIn('invalid@gmail.com', 'invalid', { credential: 'bad' }), error => error.status === 401);
  assert.equal(await User.countDocuments(), before);
  console.log('PASS: new/returning Google users, short names, concurrent signup, legacy profile, persistent sessions, stable subject, safe linking, no secret profile fields');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await stopped; }
  if (directory) rmSync(directory, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('CLEANUP: disposable database removed');
});
