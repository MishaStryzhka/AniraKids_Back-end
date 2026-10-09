const crypto = require('node:crypto');
const { HttpError, sendEmail } = require('../../helpers');
const { User } = require('../../models');
const publicUser = require('../../helpers/publicUser');

module.exports = async (req, res) => {
  const email = req.query.email.trim().toLowerCase();
  const user = await User.findById(req.user._id);
  if (!user) throw HttpError(401, 'Not authorized');
  if (await User.exists({ email })) throw HttpError(409, 'Email in use');
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const changes = {
    pendingEmail: email, pendingEmailTokenHash: hash,
    pendingEmailExpiresAt: new Date(Date.now() + 30 * 60 * 1000),
    pendingEmailOldAddress: user.email,
  };
  // Preserve the existing Seznam login identity before changing contact email.
  if (user.provider === 'seznam' && !user.seznamEmail) changes.seznamEmail = user.email;
  await User.updateOne({ _id: user._id }, { $set: changes });
  const origin = (process.env.FRONTEND_URL || 'https://anirakids.cz').replace(/\/+$/, '');
  try {
    await sendEmail({
      to: email, subject: 'ANIRAK – potvrzení změny e-mailu',
      text: `Pro potvrzení nové e-mailové adresy otevřete tento odkaz do 30 minut:\n\n${origin}/confirmEmail?changeToken=${token}\n\nDo potvrzení zůstává vaše původní adresa beze změny. Pokud jste změnu nevyžádali, tento e-mail ignorujte.\n\nANIRAK · GlamGarb Rentals s.r.o.`,
    });
  } catch {
    await User.updateOne({ _id: user._id, pendingEmailTokenHash: hash }, { $unset: {
      pendingEmail: '', pendingEmailTokenHash: '', pendingEmailExpiresAt: '', pendingEmailOldAddress: '',
    } });
    throw HttpError(503, 'Email delivery failed');
  }
  res.set('Cache-Control', 'no-store');
  res.status(200).json({ user: publicUser(user), message: 'Email change confirmation sent.' });
};
