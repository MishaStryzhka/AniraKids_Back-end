// No database or email provider. Covers monetary QR semantics and PDF pagination.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {invoicePdf,invoiceQrPayload}=require('../build/v2/services/invoice-pdf.service');
const {BOOKING_POLICY}=require('../build/v2/services/booking-policy');
const base={number:'2026-0042',sourceType:'reservation',sourceNumber:'R-LAYOUT-TEST',issuedAt:'2026-10-19T12:00:00Z',snapshot:{company:BOOKING_POLICY.company,bank:BOOKING_POLICY.bank,buyer:{name:'Žofie Černá',address:'Ukázková 12\n110 00 Praha',ico:'',email:'invoice@example.test'},serviceDate:'2026-11-03',serviceDatePlanned:true,period:'2026-11-01 - 2026-11-03',lines:[{description:'Pronájem: Slavnostní šaty (110)',amount:1000},{description:'Sleva za zkoušku ZK-LAYOUT-TEST',amount:-200}],total:800,paid:200,balance:600,deposit:2000,payments:[{type:'advance_received',method:'bank_transfer'},{type:'deposit_received',method:'cash'}]}};
async function main(){
 const {invoiceEmail}=require('../helpers/invoiceEmail');
 const sample={...base,automatic:true,sourceType:'fitting',snapshot:{...base.snapshot,buyer:{...base.snapshot.buyer,name:'Žofie <script>'},paid:200,balance:0}};
 const appointment={date:'2026-10-25',time:'17:30',address:'Testovací adresa',status:'confirmed',paymentStatus:'paid'};
 const email=invoiceEmail(sample,appointment);assert.match(email.subject,/Zkouška potvrzena · Faktura/);assert.match(email.text,/17:30/);assert.ok(!email.html.includes('<script>'));assert.equal((email.html.match(/<img/g)||[]).length,2);assert.match(email.html,/cid:anirak-instagram/);assert.match(email.html,/cid:anirak-whatsapp/);
 assert.ok(!invoiceEmail(sample,{...appointment,status:'cancelled'}).subject.includes('potvrzena'));
 const payload=invoiceQrPayload(base);
 assert.equal(payload,'SPD*1.0*ACC:CZ0708000000006644781399*AM:600.00*CC:CZK*X-VS:20260042*MSG:R-LAYOUT-TEST');
 const paid={...base,sourceType:'fitting',snapshot:{...base.snapshot,buyer:{name:'Žofie Černá',address:'',email:'invoice@example.test'},lines:[{description:'Osobní zkouška šatů',amount:200}],total:200,paid:200,balance:0,deposit:0}};
 assert.equal(invoiceQrPayload(paid),null);
 const correction={...base,sourceType:'correction',snapshot:{...base.snapshot,total:-800,paid:0,balance:0,deposit:0,originalNumber:base.number,reason:'Storno celé služby',lines:base.snapshot.lines.map(l=>({...l,amount:-l.amount}))}};
 assert.equal(invoiceQrPayload(correction),null);
 const many={...base,snapshot:{...base.snapshot,buyer:{...base.snapshot.buyer,name:'Velmi dlouhý název zákazníka se společenskými šaty a českými znaky ŽŠČŘĎŤŇ '.repeat(2),address:'Dlouhá adresa zákazníka 123, 110 00 Praha, Česká republika'},lines:Array.from({length:60},(_,i)=>({description:`${i+1}. Pronájem společenských šatů s dlouhým názvem pro ověření zalomení textu ve sloupci a velikostí 110-116`,amount:100})),total:6000,paid:200,balance:5800}};
 for(const [name,invoice] of Object.entries({partial:base,paid,correction,many})){
  const pdf=await invoicePdf(invoice);assert.equal(pdf.subarray(0,4).toString(),'%PDF');
  const pages=(pdf.toString('latin1').match(/\/Type \/Page\b/g)||[]).length;
  assert(name==='many'?pages>=3:pages===1,`${name}: unexpected page count ${pages}`);
  fs.writeFileSync(path.join(os.tmpdir(),`invoice-layout-${name}.pdf`),pdf);
 }
 console.log('PASS invoice reference layout: partial-payment QR excludes deposit, paid/correction omit payment QR, Czech fonts and multi-page output');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
