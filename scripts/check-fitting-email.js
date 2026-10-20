const assert = require('node:assert/strict');
const {fittingEmail} = require('../helpers/fittingEmail');
const doc = {number:'ZK-123456ABCDEF',date:'2026-10-25',time:'16:00',expiresAt:'2026-10-18T21:00:00Z',address:'Plzeňská 782/112, 150 00 Praha',customer:{name:'Eva <script>alert(1)</script>',email:'test@example.test'},product:{name:'Šaty <b>DET001</b>'}};
const token='a'.repeat(64);
const created=fittingEmail(doc,'created',token), confirmed=fittingEmail(doc,'confirmed');
assert.ok(created.text.includes('25. října 2026 v 16:00'));
assert.ok(created.text.includes('do 60 minut'));
assert.ok(created.text.includes(doc.address));
assert.ok(created.html.includes('https://anirakids.cz/zkouska/'+doc.number+'#'+token));
assert.ok(!created.html.includes('<script>'));
assert.ok(created.html.includes('&lt;script&gt;'));
assert.ok(!created.html.includes('<b>DET001</b>'));
assert.ok(!created.html.includes('max-width:600'));
assert.ok(created.html.includes('IČO 19970561'));
assert.ok(created.html.includes('https://wa.me/420774032738'));
assert.ok(created.html.includes('https://www.instagram.com/anirakids_cz/'));
assert.ok(created.html.includes('mailto:glamgarbrentals@seznam.cz'));
assert.ok(!confirmed.text.includes(token));
assert.ok(!confirmed.text.includes('do 60 minut'));
assert.ok(confirmed.text.includes('platbu 200 Kč jsme přijali'));
assert.equal(created.attachments.length,2);
for(const attachment of created.attachments){assert.equal(attachment.type,'image/png');assert.ok(created.html.includes('cid:'+attachment.content_id));assert.equal(Buffer.from(attachment.content,'base64').subarray(1,4).toString(),'PNG');}
assert.throws(()=>fittingEmail(doc,'created','bad'));
console.log('PASS: Czech fitting emails, full width, escaped customer data, private payment link, confirmation copy, CID social icons');

const moved=fittingEmail(doc,'rescheduled',undefined,{date:'2026-10-24',time:'10:00'});
assert.ok(moved.subject.includes('Změna termínu zkoušky'));
for(const content of [moved.text,moved.html]){
 assert.ok(content.includes('Původní termín'));
 assert.ok(content.includes('24. října 2026 v 10:00'));
 assert.ok(content.includes('Nový termín'));
 assert.ok(content.includes('25. října 2026 v 16:00'));
 assert.ok(content.includes(doc.address));
 assert.ok(content.includes('Uhrazená platba zůstává platná'));
 assert.ok(!content.includes('Zobrazit rezervaci a zaplatit'));
 assert.ok(!content.includes('#undefined'));
}
assert.ok(!moved.html.includes('<script>'));
assert.throws(()=>fittingEmail(doc,'rescheduled'));
console.log('PASS: reschedule email includes both appointments and address without requesting payment');

const {invoiceEmail}=require('../helpers/invoiceEmail');
const {textEmail}=require('../helpers/emailLayout');
const invoice={number:'2026-0001',sourceNumber:'AK-2026-TEST',sourceType:'reservation',automatic:true,snapshot:{buyer:{name:'Eva <script>x</script>',email:'test@example.test'},paid:200,balance:600,period:'25. 10. 2026'}};
for(const status of ['confirmed','prepared','rented','returned']){
 const mail=invoiceEmail(invoice,null,{status});assert.match(mail.subject,/Pronájem potvrzen · Faktura 2026-0001/);assert.match(mail.text,/Platbu 200/);assert.match(mail.text,/Váš termín pronájmu je potvrzený/);assert.match(mail.html,/data-anirak-template="reservation"/);assert.ok(!mail.html.includes('<script>'));assert.match(mail.text,/600/);
}
for(const status of ['pending','cancelled','expired',undefined])assert.ok(!invoiceEmail(invoice,null,{status}).text.includes('termín pronájmu je potvrzený'));
assert.ok(!invoiceEmail({...invoice,sourceType:'correction'},null,{status:'confirmed'}).subject.includes('Pronájem potvrzen'));
assert.ok(!invoiceEmail({...invoice,snapshot:{...invoice.snapshot,paid:0}},null,{status:'confirmed'}).subject.includes('Pronájem potvrzen'));
const recovery=textEmail({title:'Obnovení hesla',text:'Odkaz: https://anirakids.cz/refreshPassword?resetToken=abc&other=1\n\n<script>bad</script>'});
assert.match(recovery,/href="https:\/\/anirakids.cz\/refreshPassword\?resetToken=abc&amp;other=1"/);assert.ok(!recovery.includes('<script>'));
console.log('PASS: shared email layout, paid rental confirmation, safe status guard, correction and action URLs');
