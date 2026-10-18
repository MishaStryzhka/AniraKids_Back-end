import { FittingModel } from '../models/fitting.model';
const sendEmail = require('../../../helpers/sendEmail');
const { fittingEmail } = require('../../../helpers/fittingEmail');

/** At most one provider attempt per lifecycle event. Provider errors can be ambiguous:
 * never retry automatically and risk duplicate messages. Booking success is independent. */
export async function notifyFitting(doc: any, event: 'created' | 'confirmed', token?: string) {
  const field = `emailDelivery.${event}`;
  try {
    const claimed = await FittingModel.updateOne({ _id: doc._id, [`${field}.status`]: { $exists: false } },
      { $set: { [field]: { status: 'sending', attemptedAt: new Date() } } }).exec();
    if (!claimed.modifiedCount) return;
    try {
      await sendEmail(fittingEmail(doc, event, token));
      await FittingModel.updateOne({ _id: doc._id }, { $set: {
        [`${field}.status`]: 'sent', [`${field}.sentAt`]: new Date(),
      } }).exec();
    } catch (_error) {
      await FittingModel.updateOne({ _id: doc._id }, { $set: { [`${field}.status`]: 'failed' },
        $push: { audit: { action: `email_${event}_failed`, at: new Date(), by: 'system' } } }).exec();
      console.warn('FITTING_EMAIL_FAILED', event, String(doc._id));
    }
  } catch (_error) {
    // A persisted fitting/payment must never become an HTTP error due to email.
    console.warn('FITTING_EMAIL_STATUS_UNAVAILABLE', event, String(doc._id));
  }
}
