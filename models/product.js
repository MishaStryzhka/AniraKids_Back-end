const { Schema, model } = require('mongoose');
const { handleMongooseError } = require('../helpers');

const categoryOptions = [
  'women`s category',
  'men`s category',
  'children`s category',
  'decoration category',
];

const subjectOptions = [
  'Christmas',
  'Ukrainian-symbols',
  'Animals',
  'ballet-&-princesses',
  'Dinosaurs',
  'Flowers-&-butterflies',
  'Hearts',
  'unicors-&-rainbows',
];

const outfitsOptions = ['for-girls', 'for-boys', 'for-babies'];

const productSchema = new Schema(
  {
    brand: String,
    videoUrl: {
      type: String,
      validate: {
        validator: value => {
          return /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})$/.test(
            value
          );
        },
        message: 'Invalid video URL',
      },
    },
    name: {
      type: String,
      required: true,
      minlength: 3,
      maxlength: 50,
    },
    description: {
      type: String,
      required: true,
      minlength: 3,
      maxlength: 300,
    },
    brend: {
      type: String,
      minlength: 3,
      maxlength: 50,
    },
    category: {
      type: String,
      enum: categoryOptions,
      required: true,
    },
    familyLook: String,
    isPregnancy: Boolean,
    size: {
      type: String,
      required: function () {
        return ['women`s category', 'men`s category'].includes(this.category);
      },
    },
    color: {
      type: String,
      required: true,
    },
    age: {
      type: String,
      required: function () {
        return this.category === 'children`s category';
      },
    },
    childSize: {
      type: String,
      required: function () {
        return this.category === 'children`s category';
      },
    },
    decor: String,
    toys: {
      type: String,
      required: function () {
        return this.category === 'decoration category';
      },
    },
    rental: Boolean,
    sale: Boolean,
    rentalPrice: {
      type: Number,
      required: function () {
        return this.rental === true;
      },
    },
    salePrice: {
      type: Number,
      required: function () {
        return this.sale === true;
      },
    },
    keyWord: String,
    isAddPhoto: {
      type: Boolean,
      required: true,
    },
    photos: [
      {
        path: String,
        certificatePublicID: String,
      },
    ],
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    subject: {
      type: String,
      enum: {
        values: subjectOptions,
        message: 'Invalid subject value',
      },
      required: false,
    },
    outfits: {
      type: String,
      enum: {
        values: outfitsOptions,
        message: 'Invalid subject value',
      },
      required: false,
    },
  },
  { versionKey: false, timestamps: true }
);

productSchema.post('save', handleMongooseError);

const Product = model('Product', productSchema);

module.exports = Product;
