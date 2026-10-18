import {model, models, Schema} from 'mongoose';

const schema = new Schema({
  endpointHash: {type: String, required: true, unique: true},
  endpoint: {type: String, required: true},
  ownerId: {type: Schema.Types.ObjectId, required: true, index: true},
}, {collection: 'v2_admin_push_subscriptions', timestamps: true, strict: 'throw'});
schema.index({ownerId: 1, updatedAt: -1});
export const AdminPushSubscriptionModel =
  models.AdminPushSubscription ?? model('AdminPushSubscription', schema);
