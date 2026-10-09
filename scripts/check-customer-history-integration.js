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
process.env.SECRET_KEY = 'customer-history-test-only';
const { ReservationV2Model } = require('../build/v2/models');
const { listCustomerReservations } = require('../build/v2/controllers/customer-reservations.controller');
const jwt = require('jsonwebtoken');
async function read(token, page = '1') {
  let output, status;
  const res = { setHeader: () => {}, status: value => { status = value; return res; }, json: value => { output = value; } };
  await listCustomerReservations({ headers: token ? { authorization: 'Bearer ' + token } : {}, query: { page } }, res, error => { throw error; });
  return { status, body: output };
}
(async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  directory = mkdtempSync(path.join(tmpdir(), 'anirakids-customer-history-'));
  child = spawn(process.env.PUBLIC_BOOKING_MONGOD_BINARY || 'mongod', ['--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', directory, '--nounixsocket'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', data => { output += data; if (output.includes('Waiting for connections')) resolve(); });
    child.stderr.on('data', () => {});
    child.once('error', reject); child.once('exit', code => reject(new Error('Owned Mongo exited: ' + code)));
  });
  await mongoose.connect(`mongodb://127.0.0.1:${port}/history_fixture`);
  await User.init();
  const owner = await User.create({ email: 'owner@seznam.cz', provider: 'seznam' });
  const other = await User.create({ email: 'other@seznam.cz', provider: 'seznam' });
  const token = jwt.sign({ id: String(owner._id) }, process.env.SECRET_KEY);
  await User.updateOne({ _id: owner._id }, { $set: { tokens: [{ token, device: {} }] } });
  const base = { rentalMode: 'external', startDate: new Date('2026-12-01'), endDate: new Date('2026-12-02'), status: 'confirmed', subtotal: 500, deposit: 2000, totalDue: 2500, paymentStatus: 'unpaid', notes: 'PRIVATE', customerSnapshot: { email: owner.email }, items: [{ productId: new mongoose.Types.ObjectId(), variantId: new mongoose.Types.ObjectId(), inventoryItemId: new mongoose.Types.ObjectId(), productNameSnapshot: 'Fixture dress', sizeSnapshot: '110', rentalPriceSnapshot: 500, depositSnapshot: 2000 }], createdAt: new Date() };
  await ReservationV2Model.collection.insertMany([
    { ...base, reservationNumber: 'AK-2026-AAAAAA', customerId: owner._id },
    { ...base, reservationNumber: 'AK-2026-BBBBBB', customerId: other._id },
    { ...base, reservationNumber: 'AK-2026-CCCCCC', guestAccessTokenHash: 'private-guest-hash' },
  ]);
  assert.equal((await read()).status, 401);
  const result = await read(token);
  assert.equal(result.status, 200); assert.equal(result.body.total, 1);
  assert.equal(result.body.items[0].reservation.reservationNumber, 'AK-2026-AAAAAA');
  assert.ok(!JSON.stringify(result.body).includes('PRIVATE')); assert.ok(!JSON.stringify(result.body).includes(owner.email));
  assert.equal((await read(token, '2')).body.items.length, 0);
  assert.equal((await read(token, '-1')).status, 400);
  await User.updateOne({ _id: owner._id }, { $set: { tokens: [] } });
  assert.equal((await read(token)).status, 401);
  console.log('PASS: customer history is scoped to active session and owner ID; same-email guest and other accounts excluded; private data omitted; pagination validated');

})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await stopped; }
  if (directory) rmSync(directory, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('CLEANUP: disposable database removed');
});
