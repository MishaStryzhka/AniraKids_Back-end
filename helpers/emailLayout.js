const { socialIcons } = require('./fittingEmailIcons');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Only trusted template fragments go in body; escape every interpolated value.
function emailLayout({title, reference='', body, language='cs'}) {
 language=['cs','en','uk'].includes(language)?language:'cs';
  const nav = [['Šaty','saty'],['Obleky','obleky'],['Pronájem','pronajem'],['Můj účet','ucet']].map(([label,path]) => `<td align="center" width="25%"><a href="https://anirakids.cz/${path}" style="display:block;padding:12px 2px;font:14px/20px Arial,sans-serif;color:#403a37;text-decoration:none;white-space:nowrap;">${label}</a></td>`).join('');
 return `<!DOCTYPE html><html lang="${language}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body data-anirak-template="reservation" style="margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#ffffff;color:#403a37;font:16px/1.6 Arial,sans-serif;">
<tr><td align="center" style="padding:24px 12px 16px;"><a href="https://anirakids.cz" style="display:inline-block;font:30px/36px Georgia,serif;color:#403a37;text-decoration:none;">ANIRAK</a></td></tr>
<tr><td align="center" style="padding:0 8px 24px;border-bottom:1px solid #ebdad1;"><table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:360px;margin:0 auto;border-collapse:collapse;"><tr>${nav}</tr></table></td></tr>
<tr><td style="padding:28px 16px 16px;"><h1 style="margin:0;font:700 26px/1.3 Georgia,serif;text-align:center;">${escapeHtml(title)}</h1>${reference ? `<p style="text-align:center;color:#6c6158;">${escapeHtml(reference)}</p>` : ''}
${body}<p style="margin-top:28px;">Těšíme se na vás!</p><p><strong>ANIRAK</strong><br>GlamGarb Rentals s.r.o. · IČO 19970561<br><a href="mailto:glamgarbrentals@seznam.cz" style="color:#6c6158;">glamgarbrentals@seznam.cz</a><br><a href="tel:+420774032738" style="color:#6c6158;">+420 774 032 738</a> · <a href="tel:+420774032705" style="color:#6c6158;">+420 774 032 705</a></p>
<p><a href="https://www.instagram.com/anirakids_cz/" style="display:inline-block;padding:10px 8px 10px 0;color:#6c6158;text-decoration:none;"><img src="cid:anirak-instagram" width="20" height="20" alt="" style="vertical-align:middle;border:0;"> Instagram</a> · <a href="https://wa.me/420774032738" style="display:inline-block;padding:10px 0 10px 8px;color:#6c6158;text-decoration:none;"><img src="cid:anirak-whatsapp" width="20" height="20" alt="" style="vertical-align:middle;border:0;"> WhatsApp</a></p>
</td></tr><tr><td align="center" bgcolor="#ebdad1" style="padding:24px 16px;background-color:#ebdad1;text-align:center;"><p style="margin:0;font:13px/1.6 Arial,sans-serif;color:#403a37;">ANIRAK © ${new Date().getFullYear()}<br>GlamGarb Rentals s.r.o.</p></td></tr>
</table></body></html>`;
}
function textEmail({title,text}) {
 const body=String(text||'').replace(/\n+ANIRAK · GlamGarb Rentals s\.r\.o\.\s*$/, '').split(/\n\s*\n/).map(paragraph=>'<p>'+paragraph.split(/(https:\/\/[^\s]+)/g).map(part=>part.startsWith('https://')?`<a href="${escapeHtml(part)}" style="color:#7b6152;overflow-wrap:anywhere;">${escapeHtml(part)}</a>`:escapeHtml(part).replace(/\n/g,'<br>')).join('')+'</p>').join('');
 return emailLayout({title,body});
}
const withEmailLayout=message=>({...message,html:textEmail({title:message.subject,text:message.text})});
module.exports={emailLayout,textEmail,withEmailLayout,escapeHtml,socialIcons};
