import {model, models, Schema} from 'mongoose';

const schema = new Schema({
  endpointHash: {type: String, required: true, unique: true},
  endpoint: {type: String, required: true},
  ownerId: {type: Schema.Types.ObjectId, required: true, index: true},
  topics: {type: [String], default: ['fitting_payment_reported']},
  keys: {type: new Schema({p256dh: {type: String, required: true}, auth: {type: String, required: true}}, {_id: false}), default: undefined},
}, {collection: 'v2_admin_push_subscriptions', timestamps: true, strict: 'throw'});
schema.index({ownerId: 1, updatedAt: -1});
export const AdminPushSubscriptionModel =
  models.AdminPushSubscription ?? model('AdminPushSubscription', schema);
