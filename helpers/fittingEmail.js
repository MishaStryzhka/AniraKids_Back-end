const { socialIcons } = require('./fittingEmailIcons');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signatureText = 'Těšíme se na vás!\n\nANIRAK\nGlamGarb Rentals s.r.o. · IČO 19970561\nglamgarbrentals@seznam.cz\n+420 774 032 738 · +420 774 032 705\nInstagram: https://www.instagram.com/anirakids_cz/\nWhatsApp: https://wa.me/420774032738';
function fittingEmail(doc, event, token, previous) {
  if (!['created', 'confirmed', 'rescheduled', 'completed'].includes(event)) throw new Error('Invalid fitting email event');
  if (!/^ZK-[A-F0-9]{12}$/.test(doc.number)) throw new Error('Invalid fitting number');
  const origin = new URL(process.env.FRONTEND_URL || 'https://anirakids.cz');
  if (origin.protocol !== 'https:' || origin.username || origin.password) throw new Error('Invalid frontend origin');
  const created = event === 'created';
  const completed = event === 'completed';
  const rescheduled = event === 'rescheduled';
  if (rescheduled && (!previous?.date || !previous?.time)) throw new Error('Missing previous fitting appointment');
  if ((created || completed) && !/^[a-f0-9]{64}$/.test(token || '')) throw new Error('Invalid fitting access token');
  const link = completed ? `${origin.origin}/saty#fitting=${doc.number}&token=${token}` : `${origin.origin}/zkouska/${doc.number}#${token}`;
  const date = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(doc.date + 'T12:00:00Z'));
  const deadline = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' }).format(new Date(doc.expiresAt));
  const previousDate = rescheduled ? new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(previous.date + 'T12:00:00Z')) : '';
  const title = completed ? 'Zaplacená zkouška jako záloha 200 Kč' : rescheduled ? 'Změna termínu zkoušky' : created ? 'Rezervace zkoušky' : 'Vaše zkouška je potvrzena';
  const intro = completed ? 'děkujeme za návštěvu! Platbu 200 Kč za absolvovanou zkoušku můžete jednou započíst jako zálohu na pronájem. Zálohu pak znovu neplatíte. Vyberte si oblečení přes osobní odkaz a v rezervaci zvolte „Započíst platbu“. Použijte stejný e-mail jako u zkoušky. Odkaz uchovejte v soukromí.' : rescheduled ? 'termín vaší zkoušky jsme změnili. Nový termín je potvrzený. Uhrazená platba zůstává platná, nic dalšího platit nemusíte.' : created ? 'děkujeme za rezervaci zkoušky oblečení.' : 'platbu 200 Kč jsme přijali a váš termín zkoušky je potvrzený.';
  const maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(doc.address);
  const payment = `Pro dokončení rezervace uhraďte 200 Kč QR převodem do 60 minut od vytvoření rezervace (do ${deadline}). Platební údaje najdete po kliknutí na tlačítko níže. Po zaplacení zvolte „Platba odeslána“. Termín potvrdíme po ověření platby.`;
  const credit = 'Po absolvování zaplacené zkoušky můžete 200 Kč jednou započíst jako zálohu na pronájem oblečení.';
  const e = escapeHtml;
  const text = `${title} · ${doc.number}\n\nDobrý den, ${doc.customer.name},\n${intro}\n\n${rescheduled ? `Původní termín: ${previousDate} v ${previous.time} (Europe/Prague)\nNový termín` : 'Termín'}: ${date} v ${doc.time} (Europe/Prague)\nDélka zkoušky: 30 minut\nMísto: Blaze Photostudio\nAdresa: ${doc.address}\nCena zkoušky: 200 Kč${doc.product ? '\nOblečení: ' + doc.product.name : ''}\n\n${created ? payment + '\n\nZobrazit rezervaci a zaplatit: ' + link + '\n\n' : ''}${credit}${completed ? '\n\nVybrat šaty a započíst 200 Kč: ' + link : ''}\n\nZobrazit adresu na mapě: ${maps}\n\n${signatureText}`;
  const nav = [['Šaty','saty'],['Obleky','obleky'],['Pronájem','pronajem'],['Můj účet','ucet']].map(([label,path]) => `<td align="center" width="25%"><a href="https://anirakids.cz/${path}" style="display:block;padding:12px 2px;font:14px/20px Arial,sans-serif;color:#403a37;text-decoration:none;white-space:nowrap;">${label}</a></td>`).join('');
  const details = [...(rescheduled ? [['Původní termín',`${previousDate} v ${previous.time}`]] : []),[rescheduled ? 'Nový termín' : 'Termín',`${date} v ${doc.time}`],['Délka zkoušky','30 minut'],['Místo','Blaze Photostudio'],['Adresa',doc.address],['Cena zkoušky','200 Kč'],...(doc.product ? [['Oblečení',doc.product.name]] : [])].map(([label,value]) => `<tr><td style="padding:6px 10px;vertical-align:top;width:32%;">${e(label)}</td><td style="padding:6px 10px;font-weight:bold;overflow-wrap:anywhere;">${e(value)}</td></tr>`).join('');
  return { to: doc.customer.email, subject: `ANIRAK · ${title} ${doc.number}`, text,
    attachments: socialIcons,
    html: `<!DOCTYPE html><html lang="cs"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#ffffff;color:#403a37;font:16px/1.6 Arial,sans-serif;">
<tr><td align="center" style="padding:24px 12px 16px;"><a href="https://anirakids.cz" style="display:inline-block;font:30px/36px Georgia,serif;color:#403a37;text-decoration:none;">ANIRAK</a></td></tr>
<tr><td align="center" style="padding:0 8px 24px;border-bottom:1px solid #ebdad1;"><table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:360px;margin:0 auto;border-collapse:collapse;"><tr>${nav}</tr></table></td></tr>
<tr><td style="padding:28px 16px 16px;"><h1 style="margin:0;font:700 26px/1.3 Georgia,serif;text-align:center;">${e(title)}</h1><p style="text-align:center;color:#6c6158;">${e(doc.number)}</p>
<p>Dobrý den, ${e(doc.customer.name)},<br>${intro}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#faf8f6;border-collapse:collapse;">${details}</table>
${created ? `<p>${e(payment)}</p><p style="text-align:center;margin:28px 0;"><a href="${e(link)}" style="display:inline-block;padding:16px 24px;border-radius:4px;background:#7b6152;color:#ffffff;font-weight:bold;text-decoration:none;">Zobrazit rezervaci a zaplatit</a></p>` : ''}
<p>${credit}</p>${completed ? `<p style="text-align:center;margin:28px 0;"><a href="${e(link)}" style="display:inline-block;padding:16px 24px;border-radius:4px;background:#7b6152;color:#ffffff;font-weight:bold;text-decoration:none;">Vybrat šaty a započíst 200 Kč</a></p>` : ''}<p><a href="${e(maps)}" style="color:#7b6152;">Zobrazit adresu na mapě</a></p>
<p style="margin-top:28px;">Těšíme se na vás!</p><p><strong>ANIRAK</strong><br>GlamGarb Rentals s.r.o. · IČO 19970561<br><a href="mailto:glamgarbrentals@seznam.cz" style="color:#6c6158;">glamgarbrentals@seznam.cz</a><br><a href="tel:+420774032738" style="color:#6c6158;">+420 774 032 738</a> · <a href="tel:+420774032705" style="color:#6c6158;">+420 774 032 705</a></p>
<p><a href="https://www.instagram.com/anirakids_cz/" style="display:inline-block;padding:10px 8px 10px 0;color:#6c6158;text-decoration:none;"><img src="cid:anirak-instagram" width="20" height="20" alt="" style="vertical-align:middle;border:0;"> Instagram</a> · <a href="https://wa.me/420774032738" style="display:inline-block;padding:10px 0 10px 8px;color:#6c6158;text-decoration:none;"><img src="cid:anirak-whatsapp" width="20" height="20" alt="" style="vertical-align:middle;border:0;"> WhatsApp</a></p>
</td></tr><tr><td align="center" bgcolor="#ebdad1" style="padding:24px 16px;background-color:#ebdad1;text-align:center;"><p style="margin:0;font:13px/1.6 Arial,sans-serif;color:#403a37;">ANIRAK © ${new Date().getFullYear()}<br>GlamGarb Rentals s.r.o.</p></td></tr>
</table></body></html>` };
}
module.exports = { fittingEmail };
