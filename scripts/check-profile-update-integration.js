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
const context = { module: { exports: {} }, require: name => {
  if (name === '../../models') return { User };
  if (name === '../../helpers') return { HttpError: (status, message) => Object.assign(new Error(message), { status }) };
  if (name === '../../helpers/publicUser') return require('../helpers/publicUser');
  if (name === '../../schemas/users/updateSchema') return require('../schemas/users/updateSchema');
  throw new Error('Unexpected dependency ' + name);
} };
vm.runInNewContext(readFileSync(path.join(__dirname, '../controllers/auth/updateCurrentUser.js'), 'utf8'), context);
async function update(user, body, files) {
  let output;
  const res = { status: status => { assert.equal(status, 200); return res; }, json: value => { output = value; } };
  await context.module.exports({ user, body, files }, res);
  return output.user;
}
(async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  directory = mkdtempSync(path.join(tmpdir(), 'anirakids-profile-update-'));
  child = spawn(process.env.PUBLIC_BOOKING_MONGOD_BINARY || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', directory, '--nounixsocket'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => { output += data; if (output.includes('Waiting for connections')) resolve(); });
    child.stderr.on('data', () => {});
    child.once('error', reject); child.once('exit', code => reject(new Error('Owned Mongo exited: ' + code)));
  });
  await mongoose.connect(`mongodb://127.0.0.1:${port}/profile_fixture`);
  await User.init();
  const first = await User.create({ email: 'first@seznam.cz', provider: 'seznam' });
  const second = await User.create({ email: 'second@seznam.cz', provider: 'seznam', nickname: '@taken', primaryPhoneNumber: '+420777000002' });
  const saved = await update(first, { email: first.email, firstName: 'Mykhailo', lastName: 'Stryzhka', nickname: '@mykhailo.test', primaryPhoneNumber: '+420777000001' });
  assert.equal(saved.firstName, 'Mykhailo'); assert.equal(saved.nickname, '@mykhailo.test');
  assert.equal(saved.tokens, undefined); assert.equal(saved.isFirstLogin, false);
  assert.equal((await User.findById(first._id)).lastName, 'Stryzhka');
  await update(first, { email: first.email, companyName: 'Example' });
  for (const [body, status, message] of [
    [{ nickname: second.nickname, firstName: 'Changed' }, 409, 'Nickname must be unique'],
    [{ primaryPhoneNumber: second.primaryPhoneNumber, firstName: 'Changed' }, 409, 'Phone number in use'],
    [{ email: second.email, firstName: 'Changed' }, 400, 'Use the email change flow'],
    [{ typeUser: 'owner' }, 400], [{ emailVerified: true }, 400],
    [{ nickname: '@invalid space' }, 400], [{ primaryPhoneNumber: 'invalid' }, 400],
    [{ newPassword: 'Example123' }, 400, 'Use the password reset flow'],
  ]) {
    await assert.rejects(update(first, body), error => error.status === status && (!message || error.message === message));
    assert.equal((await User.findById(first._id)).firstName, 'Mykhailo');
  }
  await update(first, { firstName: 'Mykhailo' }, { avatar: [{ path: 'https://example.test/avatar.jpg', filename: 'fixture' }] });
  assert.equal((await User.findById(first._id)).avatarPublicId, 'fixture');
  console.log('PASS: same-email save, dot nickname, repeat save, persistence, safe response, conflicts without mutation, validation, protected fields, optional avatar');

})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await stopped; }
  if (directory) rmSync(directory, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('CLEANUP: disposable database removed');
});
