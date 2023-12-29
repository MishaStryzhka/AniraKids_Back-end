const { Schema, model } = require('mongoose');
const { handleMongooseError } = require('../helpers');
// const { boolean } = require('joi');

// eslint-disable-next-line no-useless-escape
const emailRegexp = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
const phoneRegexp = /^\+(?:[0-9] ?){6,14}[0-9]$/;

const userSchema = new Schema(
  {
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
    // patronymic: {
    //   type: String,
    //   trim: true,
    //   minlength: 5,
    // },
    phones: {
      type: [String],
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
    isPublish: {
      type: Boolean,
      default: false, // Set the default value to true if needed
    },
  },
  { versionKey: false, timestamps: true }
);

userSchema.post('save', handleMongooseError);

const User = model('user', userSchema);

module.exports = User;
