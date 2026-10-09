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
  const { adminOverview } = require('../build/v2/controllers/admin-overview.controller');
  const { calendarBlocks } = require('../build/v2/services/calendar-blocks');
  const { InventoryItemV2Model, ProductV2Model, VariantV2Model, AvailabilityBlockV2Model } = require('../build/v2/models');
  const {getBusinessDateOnly,parseDateOnly,addCalendarDays}=require('../build/v2/utils/date-only');
  const today=parseDateOnly(getBusinessDateOnly()); const yesterday=addCalendarDays(today,-1),tomorrow=addCalendarDays(today,1);
  const base={startDate:yesterday,endDate:today,customerSnapshot:{firstName:'Jana',lastName:'Test'},items:[{productNameSnapshot:'Šaty'}],paymentStatus:'unpaid'};
  await ReservationV2Model.collection.insertMany([
    {...base,reservationNumber:'PICK',status:'confirmed'},
    {...base,reservationNumber:'FUTURE',status:'confirmed',startDate:tomorrow,endDate:tomorrow},
    {...base,reservationNumber:'RETURN',status:'rented'},
    {...base,reservationNumber:'LATE',status:'rented',endDate:yesterday},
    {...base,reservationNumber:'PENDING',status:'pending',expiresAt:new Date(Date.now()+60000)},
    {...base,reservationNumber:'EXPIRED',status:'pending',expiresAt:new Date(Date.now()-60000)},
    {...base,reservationNumber:'HELD',status:'returned',paymentEntries:[{type:'deposit_received',amount:2000},{type:'deposit_refunded',amount:500}]},
    {...base,reservationNumber:'SETTLED',status:'returned',paymentEntries:[{type:'deposit_received',amount:2000},{type:'deposit_refunded',amount:2000}]},
    {...base,reservationNumber:'NO-DEPOSIT',status:'cancelled'},
  ]);
  const productId=new mongoose.Types.ObjectId(),variantId=new mongoose.Types.ObjectId(),inventoryItemId=new mongoose.Types.ObjectId();
  await ProductV2Model.collection.insertOne({_id:productId,name:'Fixture dress',status:'draft'});
  await VariantV2Model.collection.insertOne({_id:variantId,productId});
  await InventoryItemV2Model.collection.insertOne({_id:inventoryItemId,variantId,internalCode:'TEST-1',status:'maintenance'});
  await AvailabilityBlockV2Model.collection.insertMany([{inventoryItemId,startDate:yesterday,endDate:today,reason:'repair',notes:'PRIVATE'},{inventoryItemId,startDate:tomorrow,endDate:tomorrow,reason:'cleaning'}]);
  let result;const res={setHeader:()=>{},status:()=>res,json:v=>{result=v;}};
  await adminOverview({},res,e=>{throw e;});
  assert.equal(result.pickups.total,1);assert.equal(result.returns.total,2);assert.equal(result.overdue,1);assert.equal(result.pending.total,1);assert.equal(result.unpaid,4);assert.equal(result.deposits.total,1);assert.equal(result.deposits.items[0].number,'HELD');assert.equal(result.maintenance,1);assert.equal(result.drafts,1);
  const blocks=await calendarBlocks(getBusinessDateOnly(),getBusinessDateOnly());
  assert.equal(blocks.blocks.length,1);assert.equal(blocks.blocks[0].productId,String(productId));assert.equal(blocks.blocks[0].productName,'Fixture dress');assert.equal(blocks.blocks[0].internalCode,'TEST-1');assert.equal(blocks.blocksTruncated,false);assert.ok(!JSON.stringify(blocks).includes('PRIVATE'));
  // Registration must use the same auth/config guards as existing admin endpoints.
  const routeSource=readFileSync(path.join(__dirname,'../src/v2/routes/admin.routes.ts'),'utf8');
  assert.ok(routeSource.includes("router.get('/admin/overview', ...guards, adminOverview)"));
  console.log('PASS: Prague due dates, expired pending exclusion, held-deposit ledger, maintenance/drafts and inventory→variant→product block joins');

})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await mongoose.disconnect();
  if (child && child.exitCode === null) { const stopped = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await stopped; }
  if (directory) rmSync(directory, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log('CLEANUP: disposable database removed');
});
