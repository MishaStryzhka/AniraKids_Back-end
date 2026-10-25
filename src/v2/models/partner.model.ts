import { model, models, Schema } from 'mongoose';
export const partnerAttributionSchema = new Schema(
  {
    partnerId: { type: String, required: true },
    source: { type: String, enum: ['anirak', 'partner'], required: true },
    referralCode: String,
    staffId: String,
    createdBy: String,
    version: { type: Number, default: 1 },
  },
  { _id: false }
);
const partner = new Schema(
  {
    _id: String,
    name: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    cooperationActive: { type: Boolean, default: false },
    cooperationAudit: [{ _id: false, active: Boolean, by: String, at: Date }],
    revision: { type: Number, default: 0 },
    billing: {type: Schema.Types.Mixed},
    billingRevision: {type:Number,default:0},
    settlements: [
      {
        _id: false,
        operationId: String,
        amount: Number,
        direction: { type: String, enum: ['to_partner', 'to_anirak'] },
        note: String,
        at: Date,
        by: String,
      },
    ],
  },
  { collection: 'v2_partners', timestamps: true }
);
const member = new Schema(
  {
    partnerId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: {
      type: String,
      enum: ['administrator', 'photographer'],
      required: true,
    },
    active: { type: Boolean, default: true },
    referralCode: { type: String, required: true },
    revision: { type: Number, default: 1 },
    audit: [
      { _id: false, by: String, at: Date, role: String, active: Boolean },
    ],
  },
  { collection: 'v2_partner_members', timestamps: true }
);
member.index({ partnerId: 1, userId: 1 }, { unique: true });
member.index({ referralCode: 1 }, { unique: true });
export const PartnerModel = models.Partner ?? model('Partner', partner);
export const PartnerMemberModel =
  models.PartnerMember ?? model('PartnerMember', member);
