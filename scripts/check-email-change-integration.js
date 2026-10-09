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
let messages = [], failDelivery = false;
function controller(file) {
  const context = { module: { exports: {} }, process: { env: { FRONTEND_URL: 'https://anirakids.cz' } }, require: name => {
    if (name === '../../models') return { User };
    if (name === '../../helpers') return {
      HttpError: (status, message) => Object.assign(new Error(message), { status }),
      sendEmail: async message => { if (failDelivery) throw new Error('fixture'); messages.push(message); },
    };
    if (name === '../../helpers/publicUser') return require('../helpers/publicUser');
    if (name === 'node:crypto') return require('node:crypto');
    throw new Error('Unexpected dependency ' + name);
  } };
  vm.runInNewContext(readFileSync(path.join(__dirname, '../controllers/auth/' + file + '.js'), 'utf8'), context);
  return context.module.exports;
}
const request = controller('refreshEmail'), confirm = controller('confirmEmailChange');
async function run(fn, req) {
  let output;
  const res = { set: () => {}, status: status => { assert.equal(status, 200); return res; }, json: value => { output = value; } };
  await fn(req, res); return output;
}
const token = () => messages[messages.length - 1].text.match(/changeToken=([a-f0-9]{64})/)[1];
(async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  directory = mkdtempSync(path.join(tmpdir(), 'anirakids-email-change-'));
  child = spawn(process.env.PUBLIC_BOOKING_MONGOD_BINARY || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', directory, '--nounixsocket'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => { output += data; if (output.includes('Waiting for connections')) resolve(); });
    child.stderr.on('data', () => {});
    child.once('error', reject); child.once('exit', code => reject(new Error('Owned Mongo exited: ' + code)));
  });
  await mongoose.connect(`mongodb://127.0.0.1:${port}/email_change_fixture`);
  await User.init();
  const first = await User.create({ email: 'first@seznam.cz', provider: 'seznam' });
  await User.create({ email: 'taken@seznam.cz', provider: 'seznam' });
  const requested = await run(request, { user: first, query: { email: 'new@seznam.cz' } });
  const firstToken = token();
  assert.equal(requested.user.email, first.email); assert.equal(requested.user.pendingEmailTokenHash, undefined);
  assert.equal((await User.findById(first._id)).email, first.email);
  assert.equal((await User.findById(first._id)).seznamEmail, first.email);
  const changed = await run(confirm, { body: { token: firstToken } });
  assert.equal(changed.user.email, 'new@seznam.cz'); assert.equal(changed.user.emailVerified, true);
  await assert.rejects(run(confirm, { body: { token: firstToken } }), error => error.status === 400);
  await assert.rejects(run(confirm, { body: { token: 'bad' } }), error => error.status === 400);
  await assert.rejects(run(request, { user: first, query: { email: 'taken@seznam.cz' } }), error => error.status === 409);
  await run(request, { user: first, query: { email: 'expire@seznam.cz' } });
  await User.updateOne({ _id: first._id }, { $set: { pendingEmailExpiresAt: new Date(0) } });
  await assert.rejects(run(confirm, { body: { token: token() } }), error => error.status === 400);
  await run(request, { user: first, query: { email: 'superseded@seznam.cz' } }); const oldToken = token();
  await run(request, { user: first, query: { email: 'latest@seznam.cz' } });
  await assert.rejects(run(confirm, { body: { token: oldToken } }), error => error.status === 400);
  await User.create({ email: 'latest@seznam.cz', provider: 'seznam' });
  await assert.rejects(run(confirm, { body: { token: token() } }), error => error.status === 409);
  assert.equal((await User.findById(first._id)).email, 'new@seznam.cz');
  failDelivery = true;
  await assert.rejects(run(request, { user: first, query: { email: 'failure@seznam.cz' } }), error => error.status === 503);
  assert.equal((await User.findById(first._id)).email, 'new@seznam.cz');
  assert.equal((await User.findById(first._id).select('+pendingEmailTokenHash')).pendingEmailTokenHash, undefined);
  console.log('PASS: unchanged address until confirmation, one-time link, expiry, supersession, duplicate race, delivery failure, Seznam identity preservation, no secret response');

})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await stopped; }
  if (directory) rmSync(directory, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('CLEANUP: disposable database removed');
});
