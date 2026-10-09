const bcrypt = require('bcrypt');
const Joi = require('joi');
const { HttpError, sendEmail } = require('../../helpers');
const { User } = require('../../models');
const action = require('../../helpers/accountAction');
const generic = 'If the account exists, a recovery email will be sent.';
exports.request = async (req, res) => {
  const { value, error } = Joi.object({ email: Joi.string().trim().lowercase().email().required() }).validate(req.body);
  if (error) throw HttpError(400, 'Invalid email');
  const user = await User.findOne({ email: value.email });
  if (user) {
    const issued = await action.issue(user, 'passwordReset');
    if (issued) {
      const origin = (process.env.FRONTEND_URL || 'https://anirakids.cz').replace(/\/+$/, '');
      try { await sendEmail({ to: user.email, subject: 'ANIRAK – obnovení hesla', text: `Pro nastavení nového hesla otevřete tento odkaz do 30 minut:\n\n${origin}/refreshPassword?resetToken=${issued.token}\n\nPokud jste změnu nevyžádali, tento e-mail ignorujte. Vaše heslo se nezmění.\nANIRAK · GlamGarb Rentals s.r.o.` }); }
      catch { await action.revoke(user, 'passwordReset', issued.hash); throw HttpError(503, 'Email delivery failed'); }
    }
  }
  res.set('Cache-Control', 'no-store'); res.status(200).json({ message: generic });
};
exports.confirm = async (req, res) => {
  const { token, password } = req.body || {};
  if (!action.validToken(token) || typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) throw HttpError(400, 'Invalid recovery request');
  const hash = action.hashToken(token);
  const user = await User.findOne({ 'passwordReset.hash': hash, 'passwordReset.expiresAt': { $gt: new Date() } }).select('+passwordReset');
  if (!user) throw HttpError(400, 'Expired or already used recovery link');
  const updated = await User.findOneAndUpdate({ _id: user._id, email: user.passwordReset.email, 'passwordReset.hash': hash, 'passwordReset.expiresAt': { $gt: new Date() } }, {
    $set: { password: await bcrypt.hash(password, 10), tokens: [] },
    $unset: { passwordReset: '', token: '' },
  }, { new: true });
  if (!updated) throw HttpError(400, 'Expired or already used recovery link');
  res.set('Cache-Control', 'no-store'); res.status(200).json({ message: 'Password updated. Please sign in again.' });
};
