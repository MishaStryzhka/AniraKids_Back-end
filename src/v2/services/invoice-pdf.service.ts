import path = require('path');
import {readFileSync} from 'fs';
const PDFDocument=require('pdfkit');
const QRCode=require('qrcode');

const money=(n:number)=>new Intl.NumberFormat('cs-CZ',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n).replace(/\u00a0/g,' ')+' Kč';
const date=(value:string|Date)=>{
 const d=new Date(value);if(!Number.isFinite(d.getTime()))return String(value);
 const parts=new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',day:'2-digit',month:'2-digit',year:'numeric'}).formatToParts(d);
 return ['day','month','year'].map(type=>parts.find(p=>p.type===type)?.value).join('. ');
};
const clean=(value:unknown)=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
export function invoiceQrPayload(invoice:any):string|null{
 const s=invoice.snapshot;
 // An immutable invoice records the outstanding amount at issuance. Never ask
 // for the full rental again or include a refundable deposit in this QR.
 if(invoice.sourceType==='correction'||!(s.balance>0)||!/^CZ\d{22}$/.test(s.bank.iban))return null;
 const vs=String(invoice.number).replace(/\D/g,'');
 const message=clean(invoice.sourceNumber||invoice.number).replace(/\*/g,' ').slice(0,60);
 return `SPD*1.0*ACC:${s.bank.iban}*AM:${s.balance.toFixed(2)}*CC:CZK${/^\d{1,10}$/.test(vs)?`*X-VS:${vs}`:''}*MSG:${message}`;
}
function paymentMethod(invoice:any){
 const s=invoice.snapshot;
 const methods=[...new Set((s.payments??[]).filter((p:any)=>['advance_received','rental_received'].includes(p.type)).map((p:any)=>p.method).filter(Boolean))];
 const method=s.paymentMethod||(invoice.sourceType==='fitting'&&(s.payments??[]).some((p:any)=>p.action==='confirm')?'bank_transfer':methods.length===1?methods[0]:null);
 return ({bank_transfer:'Bankovní převod',card:'Platební karta',cash:'Hotově'} as any)[method as string]||(methods.length>1?'Kombinovaná platba':'Dle rezervace');
}

/** Shared renderer for email attachments, downloads and accounting archives.
 * Geometry, IBM Plex Sans and grey rules follow the owner's supplied invoice.
 * Values always come from the issued snapshot; the reference customer is not used.
 */
export async function invoicePdf(invoice:any):Promise<Buffer>{
 const regular=readFileSync(path.join(__dirname,'../../../assets/fonts/IBMPlexSans-Regular.ttf'));
 const bold=readFileSync(path.join(__dirname,'../../../assets/fonts/IBMPlexSans-Bold.ttf'));
 return new Promise((resolve,reject)=>{
  const doc=new PDFDocument({size:'A4',margin:0,bufferPages:true,info:{Title:`${invoice.sourceType==='correction'?'Opravný doklad':'Faktura'} ${invoice.number}`,Author:'GlamGarb Rentals s.r.o.'}}),chunks:Buffer[]=[];
  doc.on('data',(c:Buffer)=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
  doc.registerFont('regular',regular);doc.registerFont('bold',bold);
  const s=invoice.snapshot,L=26.9291,R=568.3465,C=332.6303,LE=291.3803,W=R-L,grey='#5e5e5e';
  const text=(value:unknown,x:number,y:number,width:number,size=9.75,color='#000000',weight='regular',align='left')=>{
   doc.font(weight).fontSize(size).fillColor(color).text(clean(value),x,y-size*.245,{width,align,lineGap:0});return doc.y-size*.055;
  };
  const rule=(x:number,y:number,width:number,height=.75,color='#cccccc')=>doc.rect(x,y,width,height).fill(color);
  const pair=(label:string,value:unknown,x:number,end:number,y:number)=>{
   text(label,x,y,115,9.75,grey);text(value,x+117,y,end-x-117,9.75,'#000000','regular','right');
  };
  const header=()=>{
   rule(C,29,R-C,2.25,'#595959');
   const title=invoice.sourceType==='correction'?'Opravný doklad':'Faktura';
   const size=invoice.sourceType==='correction'?14:18;
   doc.font('bold').fontSize(size);
   const titleWidth=doc.widthOfString(title);
   text(title,C,40.55,titleWidth+1,size,'#000000','bold');
   text(' '+invoice.number,C+titleWidth,40.55,R-C-titleWidth,size,grey,'bold');
  };
  header();
  rule(L,82.1,13.5,.75,grey);rule(C,82.1,13.5,.75,grey);
  text('DODAVATEL',L,92.7875,LE-L,9.75,grey);text('ODBĚRATEL',C,92.7875,R-C,9.75,grey);
  const companyNameBottom=text(s.company.name,L,118.2875,LE-L,11.25,'#000000','bold');
  const buyerNameBottom=text(s.buyer.name,C,118.2875,R-C,11.25,'#000000','bold');
  // Same registered address as the supplied layout, formatted in its two lines.
  const companyAddress=s.company.ico==='19970561'&&s.company.address==='Bílkova 855/19, Staré Město, 110 00 Praha 1'?'Bílkova 855/19\n110 00 Praha - Staré Město':clean(s.company.address).replace(/,\s*/g,'\n');
  const address=(value:string,x:number,y:number,width:number)=>{
   let bottom=y;for(const line of value.split(/\n|,\s*/).filter(Boolean)){bottom=text(line,x,bottom,width,9.75,grey)+4.875;}return bottom;
  };
  const companyBottom=address(companyAddress,L,Math.max(134.7875,companyNameBottom+2),LE-L);
  let buyerBottom=address(clean(s.buyer.address),C,Math.max(134.7875,buyerNameBottom+2),R-C);
  if(!s.buyer.address&&s.buyer.email)buyerBottom=text(s.buyer.email,C,Math.max(134.7875,buyerNameBottom+2),R-C,9.75,grey);
  const identityY=Math.max(179.0375,companyBottom+14,buyerBottom+14);
  pair('IČO',s.company.ico,L,LE,identityY);
  if(s.buyer.ico)pair('IČO',s.buyer.ico,C,R,identityY);
  text('Neplátce DPH',L,identityY+14.625,LE-L);
  const metaY=identityY+44.25;
  pair('Bankovní účet',s.bank.accountNumber,L,LE,metaY);
  pair('Variabilní symbol',String(invoice.number).replace(/\D/g,''),L,LE,metaY+14.625);
  pair('Způsob platby',paymentMethod(invoice),L,LE,metaY+29.25);
  pair('Datum vystavení',date(invoice.issuedAt),C,R,metaY);
  pair('Datum splatnosti',s.dueDate?date(s.dueDate):s.balance>0?'Při převzetí služby':invoice.sourceType==='correction'?'—':'Uhrazeno',C,R,metaY+14.625);

  let y=Math.max(299.975,metaY+76.6875);
  const tableHeader=()=>{text('CENA',460.063,y,R-460.063,9,grey,'regular','right');rule(L,y+14.25,W);y+=20.4375;};
  const newPage=()=>{doc.addPage();header();y=92.7875;tableHeader();};
  tableHeader(); // First row top: 320.4125 in the reference.
  for(const line of s.lines){
   doc.font('regular').fontSize(9.75);
   const height=Math.max(11.7,doc.heightOfString(clean(line.description),{width:421,lineGap:0})-2.925);
   if(y+height+10>755)newPage();
   text(line.description,L,y,421);
   text(money(line.amount),460.063,y,R-460.063,9.75,'#000000','regular','right');
   y+=height+9.675;rule(L,y-6.1875,W);
  }
  if(y+180>780)newPage();
  const summaryY=y+23.0625;
  rule(297.6378,summaryY,R-297.6378,1.5,'#595959');
  text(money(s.total),297.6378,summaryY+6.75,R-297.6378,15,'#595959','bold','right');
  let detailY=summaryY+32;
  if(invoice.sourceType!=='correction'&&s.paid>0){
   pair('Uhrazeno k vystavení',money(s.paid),297.6378,R,detailY);detailY+=15;
   pair('Zbývá k vystavení',money(s.balance),297.6378,R,detailY);detailY+=15;
  }
  if(s.overpayment){pair('Přeplatek',money(s.overpayment),297.6378,R,detailY);detailY+=15;}
  const payload=invoiceQrPayload(invoice);
  if(payload){
   const qy=summaryY-1.5,qr=QRCode.create(payload,{errorCorrectionLevel:'M'}),size=84,step=size/qr.modules.size;
   doc.rect(L,qy,102.75,102.75).lineWidth(.5).strokeColor('#cccccc').stroke();
   for(let row=0;row<qr.modules.size;row++)for(let col=0;col<qr.modules.size;col++)if(qr.modules.get(row,col))doc.rect(L+9.375+col*step,qy+9.375+row*step,step,step).fill('#000000');
   doc.rect(L+11.3386,qy+94.2461,49.4948,16).fill('#ffffff');
   text('QR Platba',L+14.3386,qy+99.6836,48,9.75,'#a0a0a0');
  }else if(invoice.sourceType!=='correction')text('UHRAZENO',L,summaryY+6.75,160,15,grey,'bold');
  // Operational details retain the same restrained typography beneath the total.
  let notesY=Math.max(summaryY+120,detailY+12);
  const notes:string[]=[];
  if(invoice.sourceNumber)notes.push(`Zkouška / rezervace: ${invoice.sourceNumber}`);
  if(s.period)notes.push(`${s.serviceDatePlanned?'Plánovaný termín služby':'Období služby'}: ${s.period}`);
  if(s.accountingDate)notes.push(`Platba zaznamenána dne: ${date(s.accountingDate)}`);
  if(s.deposit)notes.push(`Vratná kauce: ${money(s.deposit)}. Není součástí ceny služby.`);
  if(s.originalNumber)notes.push(`Oprava faktury: ${s.originalNumber}`,`Důvod: ${s.reason}`,'Tento doklad sám nepotvrzuje vrácení platby.');
  if(payload&&s.paid>0)notes.push('QR platba obsahuje pouze částku zbývající při vystavení. Pozdější úhrady jsou evidovány u rezervace.');
  for(const note of notes){
   doc.font('regular').fontSize(8.25);const height=doc.heightOfString(note,{width:W});
   if(notesY+height>780){doc.addPage();header();notesY=92.7875;}
   notesY=text(note,L,notesY,W,8.25,grey)+3;
  }
  const pages=doc.bufferedPageRange();
  for(let i=0;i<pages.count;i++){
   doc.switchToPage(i);
   const registration=clean(s.company.register).replace(/^Městský soud v Praze/,'Městským soudem v Praze').replace(/,\s*oddíl/,' oddíl');
   text(`Společnost je zapsána v obchodním rejstříku vedeném ${registration.endsWith('.')?registration:registration+'.'}`,L,814.0726,W,8.25,grey);
   if(pages.count>1)text(`${i+1} / ${pages.count}`,R-45,795,45,8.25,grey,'regular','right');
  }
  doc.end();
 });
}
