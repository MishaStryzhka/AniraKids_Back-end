const { Schema, model } = require('mongoose');
const handleMongooseError = require('../helpers/handleMongooseError');

// eslint-disable-next-line no-useless-escape
const emailRegexp = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
const phoneRegexp = /^\+(?:[0-9] ?){6,14}[0-9]$/;

const userSchema = new Schema(
  {
    isFirstLogin: {
      type: Boolean,
      default: true,
    },
    language: {
      type: String,
    },
    email: {
      type: String,
      lowercase: true,
      match: emailRegexp,
      unique: true,
      sparse: true, // дозволяє null значенням бути унікальними
      validate: {
        validator: function (value) {
          // Either email or primaryPhoneNumber should be present
          return !!(value || this.primaryPhoneNumber);
        },
        message: 'Email or primaryPhoneNumber is required',
      },
    },
    nickname: {
      type: String,
      unique: true,
      sparse: true,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    primaryPhoneNumber: {
      type: String,
      match: phoneRegexp,
      unique: true,
      sparse: true, // дозволяє null значенням бути унікальними
      required: [
        function () {
          return !this.email;
        },
        'Email or primaryPhoneNumber is required',
      ],
    },
    primaryPhoneNumberVerified: {
      type: Boolean,
      default: false,
    },
    password: {
      type: String,
      required: function () {
        return this.provider === 'AniraKids';
      },
    },
    firstName: {
      type: String,
      trim: true,
      minlength: 3,
    },
    lastName: {
      type: String,
      trim: true,
      minlength: 3,
    },
    patronymic: {
      type: String,
      trim: true,
      minlength: 5,
    },
    dateOfBirthday: {
      type: Date,
      max: new Date(),
    },
    googleId: { type: String, unique: true, sparse: true },
    seznamEmail: { type: String, unique: true, sparse: true, lowercase: true },
    emailVerification: { type: new Schema({ hash: String, email: String, expiresAt: Date, requestedAt: Date }, { _id: false }), select: false },
    passwordReset: { type: new Schema({ hash: String, email: String, expiresAt: Date, requestedAt: Date }, { _id: false }), select: false },
    pendingEmail: { type: String, select: false },
    pendingEmailTokenHash: { type: String, select: false },
    pendingEmailExpiresAt: { type: Date, select: false },
    pendingEmailOldAddress: { type: String, select: false },
    provider: {
      type: String,
      default: 'AniraKids',
    },
    avatar: String,
    avatarPublicId: String,
    token: {
      type: String,
    },
    tokens: [
      {
        token: { type: String, required: true },
        device: { type: Object, required: true },
        lastLogin: { type: Date, default: Date.now },
      },
    ],
    favorites: [{ type: Schema.Types.ObjectId, ref: 'ProductV2' }],
    // Historical marketplace data stays in existing documents. No active role,
    // validation, defaults or API writes depend on these archived fields.
    typeUser: { type: String, select: false },
    billingDetails: { type: Schema.Types.Mixed, select: false },
    bankAccount: { type: Schema.Types.Mixed, select: false },
    rating: { type: Number, select: false },
    ratingCount: { type: Number, select: false },
    cart: { type: [Schema.Types.ObjectId], default: undefined, select: false },
    pickupAddresses: { type: [Schema.Types.Mixed], default: undefined, select: false },
  },
  { versionKey: false, timestamps: true }
);

userSchema.post('save', handleMongooseError);

const User = model('user', userSchema);

module.exports = User;
