const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => new Intl.NumberFormat('cs-CZ', {style:'currency',currency:'CZK'}).format(value);

// One compact transactional message with one PDF, without navigation or image attachments.
function invoiceEmail(invoice, fitting) {
 const s=invoice.snapshot, correction=invoice.sourceType==='correction';
 const confirmed=invoice.automatic && invoice.sourceType==='fitting' && fitting?.status==='confirmed' && fitting?.paymentStatus==='paid';
 const title=confirmed?'Zkouška potvrzena':correction?'Opravný doklad':'Faktura';
 const intro=confirmed?`Platbu ${money(s.paid)} jsme přijali. Váš termín zkoušky je potvrzený.`:`V příloze posíláme ${correction?'opravný doklad':'fakturu'} ${invoice.number}.`;
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
 const attachment=confirmed?`Faktura ${invoice.number} je v příloze (PDF).`:'';
 const e=escapeHtml;
 const text=`Dobrý den, ${s.buyer.name},\n\n${intro}\n\n${details.map(([label,value])=>`${label}: ${value}`).join('\n')}\n\n${[attachment,note].filter(Boolean).join('\n')}\n\nANIRAK · GlamGarb Rentals s.r.o.\nglamgarbrentals@seznam.cz · +420 774 032 738`;
 return {to:s.buyer.email,subject:`ANIRAK · ${title}${confirmed?' a faktura':''} ${invoice.number}`,text,
  html:`<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff;color:#403a37;font:15px/1.5 Arial,sans-serif;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;text-align:left;"><tr><td><div style="font:24px/1.2 Georgia,serif;">ANIRAK</div><h1 style="font:700 20px/1.3 Arial,sans-serif;margin:18px 0 12px;">${e(title)}</h1><p>Dobrý den, ${e(s.buyer.name)},<br>${e(intro)}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf8f6;table-layout:fixed;">${details.map(([label,value])=>`<tr><td style="padding:6px 10px;width:37%;vertical-align:top;">${e(label)}</td><td style="padding:6px 10px;overflow-wrap:anywhere;font-weight:bold;">${e(value)}</td></tr>`).join('')}</table>${attachment?`<p>${e(attachment)}</p>`:''}${note?`<p style="font-size:13px;color:#6c6158;">${e(note)}</p>`:''}<p style="border-top:1px solid #ebdad1;padding-top:12px;font-size:12px;color:#6c6158;">ANIRAK · GlamGarb Rentals s.r.o.<br><a href="mailto:glamgarbrentals@seznam.cz" style="color:#6c6158;">glamgarbrentals@seznam.cz</a> · <a href="tel:+420774032738" style="color:#6c6158;">+420 774 032 738</a></p></td></tr></table></td></tr></table></body></html>`};
}
module.exports={invoiceEmail};
