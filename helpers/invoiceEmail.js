const {emailLayout}=require('./emailLayout');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('cs-CZ', {style:'currency',currency:'CZK'}).format(value);

// One confirmation message includes the PDF; the shared layout supplies branding.
function invoiceEmail(invoice, fitting, reservation) {
 const s=invoice.snapshot, correction=invoice.sourceType==='correction';
 const confirmed=invoice.automatic && invoice.sourceType==='fitting' && fitting?.status==='confirmed' && fitting?.paymentStatus==='paid';
 const rentalConfirmed=invoice.sourceType==='reservation' && ['confirmed','prepared','rented','returned'].includes(reservation?.status) && s.paid>0;
 const combined=confirmed||rentalConfirmed;
 const title=rentalConfirmed?'Pronájem potvrzen':confirmed?'Zkouška potvrzena':correction?'Opravný doklad':'Faktura';
 const intro=rentalConfirmed?`Platbu ${money(s.paid)} jsme přijali. Váš termín pronájmu je potvrzený.`:confirmed?`Platbu ${money(s.paid)} jsme přijali. Váš termín zkoušky je potvrzený.`:`V příloze posíláme ${correction?'opravný doklad':'fakturu'} ${invoice.number}.`;
 const details=[['Číslo rezervace',invoice.sourceNumber]];
 if(fitting){
  const day=new Intl.DateTimeFormat('cs-CZ',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(fitting.date+'T12:00:00Z'));
  details.push(['Termín',`${day} v ${fitting.time} (30 minut)`],['Adresa',fitting.address]);
  if(fitting.status==='cancelled')details.push(['Stav zkoušky','Zrušena']);
 }else if(s.period)details.push(['Termín služby',s.period]);
 if(!correction){
  details.push(['Uhrazeno při vystavení',money(s.paid)]);
  if(s.balance>0)details.push(['Zbývalo uhradit',money(s.balance)]);
 }
 const note=correction?'Doklad sám nepotvrzuje vrácení peněz.':confirmed?'Po absolvování zkoušky můžete jednou uplatnit slevu 200 Kč na pronájem.':s.balance>0?'Další úhrady jsou evidovány u rezervace. Vratná kauce je samostatně.':'';
 const attachment=combined?`Faktura ${invoice.number} je v příloze (PDF).`:'';
 const e=escapeHtml;
 const text=`Dobrý den, ${s.buyer.name},\n\n${intro}\n\n${details.map(([label,value])=>`${label}: ${value}`).join('\n')}\n\n${[attachment,note].filter(Boolean).join('\n')}\n\nANIRAK · GlamGarb Rentals s.r.o.\nglamgarbrentals@seznam.cz · +420 774 032 738`;
 return {to:s.buyer.email,subject:`ANIRAK · ${title}${combined?' · Faktura':''} ${invoice.number}`,text,
  html:emailLayout({title,reference:invoice.sourceNumber,body:`<p>Dobrý den, ${e(s.buyer.name)},<br>${e(intro)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf8f6;table-layout:fixed;">${details.map(([label,value])=>`<tr><td style="padding:6px 10px;width:37%;vertical-align:top;">${e(label)}</td><td style="padding:6px 10px;overflow-wrap:anywhere;font-weight:bold;">${e(value)}</td></tr>`).join('')}</table>${attachment?`<p>${e(attachment)}</p>`:''}${note?`<p style="font-size:13px;color:#6c6158;">${e(note)}</p>`:''}`})};
}
module.exports={invoiceEmail};
