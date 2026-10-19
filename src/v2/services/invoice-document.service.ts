import path = require('path');
import {ReservationV2Model} from '../models/reservation-v2.model';
import {FittingModel} from '../models/fitting.model';
import {invoicePeriod} from './invoice.service';
import {zipSync,strToU8} from 'fflate';
const PDFDocument=require('pdfkit');
const money=(n:number)=>`${n.toFixed(2).replace('.',',')} Kč`;
export async function invoicePdf(invoice:any):Promise<Buffer>{
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:48,info:{Title:`Faktura ${invoice.number}`,Author:'GlamGarb Rentals s.r.o.'}}),chunks:Buffer[]=[];
  doc.on('data',(c:Buffer)=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  doc.font(path.join(__dirname,'../../../assets/fonts/DejaVuSans.ttf'));
  const s=invoice.snapshot;
  doc.fontSize(23).text(`${invoice.sourceType==='correction'?'Opravný doklad':'Faktura'} ${invoice.number}`);
  doc.moveDown().fontSize(10).text(`Vystaveno: ${new Date(invoice.issuedAt).toLocaleDateString('cs-CZ',{timeZone:'Europe/Prague'})}`)
   .text(`Datum poskytnutí služby: ${s.serviceDate}`).text(`Zkouška / rezervace: ${invoice.sourceNumber}`);
  if(s.originalNumber)doc.text(`Oprava faktury: ${s.originalNumber}`).text(`Důvod: ${s.reason}`);
  doc.moveDown().fontSize(12).text('Dodavatel').fontSize(10).text(s.company.name).text(s.company.address).text(`IČO: ${s.company.ico}`).text(s.company.register).text('Nejsme plátci DPH.');
  doc.moveDown().fontSize(12).text('Odběratel').fontSize(10).text(s.buyer.name).text(s.buyer.address);
  if(s.buyer.ico)doc.text(`IČO: ${s.buyer.ico}`);
  doc.moveDown().text(`Období služby: ${s.period}`).moveDown();
  for(const line of s.lines){if(doc.y>680)doc.addPage();doc.fontSize(11).text(line.description).text(money(line.amount),{align:'right'}).moveDown(.4);}
  if(doc.y>610)doc.addPage();
  doc.moveDown().fontSize(15).text(`Celkem: ${money(s.total)}`,{align:'right'}).fontSize(10);
  if(invoice.sourceType!=='correction'){
   doc.text(`Uhrazeno k vystavení: ${money(s.paid)}`,{align:'right'}).text(`Zbývá uhradit k vystavení: ${money(s.balance)}`,{align:'right'});
   if(s.overpayment)doc.text(`Přeplatek k vypořádání: ${money(s.overpayment)}`,{align:'right'});
   if(s.balance)doc.text('Splatnost: při převzetí služby (dle rezervace).');
   doc.moveDown().text(`Vratná kauce evidovaná zvlášť: ${money(s.deposit)}. Není součástí ceny služby.`);
  }else doc.moveDown().text('Tento doklad sám nepotvrzuje vrácení platby. Vrácení peněz je evidováno samostatně.');
  doc.moveDown().text(`Účet: ${s.bank.accountNumber}`).text(`IBAN: ${s.bank.iban}`).text(`Zpráva pro příjemce: ${invoice.sourceNumber}`);
  doc.end();
 });
}
const csv=(rows:unknown[][])=>'\uFEFF'+rows.map(row=>row.map(v=>'"'+(typeof v==='number'?String(v):String(v??'').replace(/^[=+\-@\t\r]/,"'$&")).replace(/"/g,'""')+'"').join(';')).join('\r\n');
export async function invoiceArchive(invoices:any[],period:string){
 const files:Record<string,Uint8Array>={};
 const rows:unknown[][]=[['Číslo','Vystaveno','Typ','Rezervace / zkouška','Odběratel','IČO','Cena CZK','Uhrazeno při vystavení CZK','Kauce při vystavení CZK','Oprava faktury']];
 for(const i of invoices){files[`${i.number}.pdf`]=await invoicePdf(i);const s=i.snapshot;rows.push([i.number,new Date(i.issuedAt).toISOString(),i.sourceType,i.sourceNumber,s.buyer.name,s.buyer.ico,s.total,s.paid,s.deposit,s.originalNumber]);}
 files['faktury.csv']=strToU8(csv(rows));
 const range=invoicePeriod(period).issuedAt;
 const paymentRows:unknown[][]=[['Zaznamenáno','Zdroj','Číslo','Typ','Částka CZK','Způsob','Reference','Poznámka','Zaznamenal']];
 const rentals:any[]=await ReservationV2Model.find({'paymentEntries.recordedAt':range}).select('reservationNumber paymentEntries').limit(10001).lean();
 const fittings:any[]=await FittingModel.find({'audit.at':range,'audit.action':{$in:['confirm','late-payment','refund']}}).select('number audit').limit(10001).lean();
 if(rentals.length>10000||fittings.length>10000)throw new Error('Export too large; select a month');
 for(const r of rentals)for(const p of r.paymentEntries??[])if(new Date(p.recordedAt)>=range.$gte&&new Date(p.recordedAt)<range.$lt)paymentRows.push([new Date(p.recordedAt).toISOString(),'pronájem',r.reservationNumber,p.type,p.amount,p.method,p.reference,p.note,p.recordedBy]);
 for(const f of fittings)for(const p of f.audit??[])if(['confirm','late-payment','refund'].includes(p.action)&&new Date(p.at)>=range.$gte&&new Date(p.at)<range.$lt)paymentRows.push([new Date(p.at).toISOString(),'zkouška',f.number,p.action==='refund'?'fitting_refunded':'fitting_received',200,'bank_transfer',f.number,'Datum zaznamenání administrátorem',p.by]);
 files['platby-a-vratky.csv']=strToU8(csv(paymentRows));
 files['README.txt']=strToU8('Faktury podle data vystavení (Europe/Prague). Částky úhrad a kaucí jsou stavem při vystavení. Soubor platby-a-vratky.csv obsahuje události zaznamenané ve vybraném období, včetně záloh, kaucí a vratek i bez vystavené faktury. Částky událostí jsou kladné; jejich význam určuje sloupec Typ. Datum zaznamenání nemusí být datem bankovního převodu. Starší platby bez evidence událostí nejsou doplňovány odhadem. Porovnejte s bankovními výpisy.');
 return Buffer.from(zipSync(files,{level:6}));
}
