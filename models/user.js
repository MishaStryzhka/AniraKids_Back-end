const { Schema, model } = require('mongoose');
const { handleMongooseError } = require('../helpers');
// const { boolean } = require('joi');

// eslint-disable-next-line no-useless-escape
const emailRegexp = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;

const userSchema = new Schema(
  {
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: emailRegexp,
      unique: true,
      required: [true, 'Email is required'],
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
      default: 'Dentist Portal',
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
