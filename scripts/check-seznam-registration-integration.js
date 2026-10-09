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
const repair = require('../config/repairUserListIndexes');
assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.PUBLIC_BOOKING_TEST_ALLOW, '1');
mongoose.set('strictQuery', true);
let child, directory;
const watchdog = setTimeout(() => { child?.kill('SIGKILL'); process.exit(1); }, 60000);
watchdog.unref();
async function signIn(email) {
  const context = { module: { exports: {} }, process: { env: { SECRET_KEY: 'local-test', SEZNAM_CLIENT_ID: 'test', SEZNAM_CLIENT_SECRET: 'test' } }, require: name => {
    if (name === 'axios') return { default: { post: async () => ({ data: { access_token: 'fixture' } }), get: async () => ({ data: { email } }) } };
    if (name === '../../models') return { User };
    if (name === '../../helpers') return { HttpError: (status, message) => Object.assign(new Error(message), { status }) };
    if (name === '../../helpers/publicUser') return require('../helpers/publicUser');
    return require(name);
  } };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../controllers/auth/authBySeznam.js'), 'utf8'), context);
  let output;
  const res = { set: () => {}, status: status => { assert.equal(status, 201); return res; }, json: body => { output = body; } };
  await context.module.exports({ body: { code: 'fixture', redirect_uri: 'https://anirakids.cz' }, headers: {} }, res);
  assert.ok(output.token); assert.ok(output.user.userID); assert.equal(output.user.tokens, undefined);
  return output;
}
(async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  directory = mkdtempSync(path.join(tmpdir(), 'anirakids-seznam-registration-'));
  child = spawn(process.env.PUBLIC_BOOKING_MONGOD_BINARY || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', directory, '--nounixsocket'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => { output += data; if (output.includes('Waiting for connections')) resolve(); });
    child.stderr.on('data', () => {});
    child.once('error', reject); child.once('exit', code => reject(new Error('Owned Mongo exited: ' + code)));
  });
  await mongoose.connect(`mongodb://127.0.0.1:${port}/seznam_fixture`);
  await User.init();
  // Reproduce the old production schema with both erroneous unique indexes.
  await User.collection.createIndex({ favorites: 1 }, { unique: true });
  await User.collection.createIndex({ cart: 1 }, { unique: true });
  await User.collection.createIndex({ favorites: 1, provider: 1 });
  await signIn('first@seznam.cz');
  await assert.rejects(signIn('second@seznam.cz'), error => error.code === 11000 && !!error.keyPattern.favorites);
  console.log('PASS: legacy indexes reproduce second-account failure');
  await Promise.all([repair(mongoose.connection.db), repair(mongoose.connection.db)]);
  await repair(mongoose.connection.db);
  const indexes = await User.collection.listIndexes().toArray();
  assert.ok(!indexes.some(index => index.unique && ['favorites_1', 'cart_1'].includes(index.name)));
  assert.ok(indexes.some(index => index.name === 'email_1' && index.unique));
  assert.ok(indexes.some(index => index.name === 'favorites_1_provider_1'));
  const second = await signIn('second@seznam.cz');
  const third = await signIn('third@seznam.cz');
  assert.notEqual(second.user.userID, third.user.userID);
  const again = await signIn('second@seznam.cz');
  assert.equal(again.user.userID, second.user.userID);
  assert.equal(await User.countDocuments(), 3);
  assert.equal((await User.findOne({ email: 'second@seznam.cz' })).tokens.length, 1);
  await assert.rejects(User.create({ email: 'second@seznam.cz', provider: 'seznam' }), error => error.code === 11000 && !!error.keyPattern.email);
  const sharedItem = new mongoose.Types.ObjectId();
  await User.updateMany({}, { $set: { favorites: [sharedItem], cart: [sharedItem] } });
  assert.equal(await User.countDocuments({ favorites: sharedItem, cart: sharedItem }), 3);
  await User.updateOne({ _id: second.user.userID }, { $set: { email: 'changed@seznam.cz' } });
  const afterChange = await signIn('second@seznam.cz');
  assert.equal(afterChange.user.userID, second.user.userID);
  assert.equal(afterChange.user.email, 'changed@seznam.cz');
  assert.equal(await User.countDocuments(), 3);
  console.log('PASS: new/existing Seznam accounts, saved sessions, shared lists, email uniqueness, idempotent targeted migration');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await stopped; }
  if (directory) rmSync(directory, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('CLEANUP: disposable database removed');
});
