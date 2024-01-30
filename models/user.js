const { Schema, model } = require('mongoose');
const { handleMongooseError } = require('../helpers');
// const { boolean } = require('joi');

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
      minlength: 6,
      required: [true, 'Set password for user'],
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
    provider: {
      type: String,
      default: 'AniraKids',
    },
    avatar: String,
    avatarPublicId: String,
    token: {
      type: String,
    },
    typeUser: {
      type: String,
      enum: ['renter', 'owner'],
      default: 'renter',
    },
    billingDetails: {
      name: {
        type: String,
        required: function () {
          return this.typeUser === 'owner';
        },
        match: /^[a-zA-Z\u00C0-\u017F\s]+$/,
      },
      street: {
        type: String,
        required: function () {
          return this.typeUser === 'owner';
        },
        match: /^[a-zA-Z\u00C0-\u017F\s]+\s\d+\/\d+$/,
      },
      city: {
        type: String,
        required: function () {
          return this.typeUser === 'owner';
        },
        match: /^[a-zA-Z\u00C0-\u017F\s]+$/,
      },
      zip: {
        type: String,
        required: function () {
          return this.typeUser === 'owner';
        },
        match: /^\d{5}$/,
      },
      сountry: {
        type: String,
        default: 'Česká republika',
        enum: ['Česká republika'],
      },
      vatMode: {
        type: String,
        required: function () {
          return this.typeUser === 'owner';
        },
        default: 'non_vat_payer',
        enum: ['non_vat_payer', 'identified_person', 'vat_payer'],
      },
      companyID: {
        type: String,
        validate: {
          validator: function (value) {
            return value === '' || /^[a-zA-Z\u00C0-\u017F\s\d]+$/.test(value);
          },
          message: 'Invalid companyID format',
        },
      },
      VATID: {
        type: String,
        required: false,
        match: /^[a-zA-Z\u00C0-\u017F\s\d]+$/,
      },
    },
  },
  { versionKey: false, timestamps: true }
);

userSchema.post('save', handleMongooseError);

const User = model('user', userSchema);

module.exports = User;
