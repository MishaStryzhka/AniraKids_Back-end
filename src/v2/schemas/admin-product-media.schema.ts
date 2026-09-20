import Joi = require('joi');

export interface CompleteProductPhotoAdminBody {
  publicId: string;
  alt?: string;
}

export interface UpdateProductPhotoAltAdminBody {
  publicId: string;
  alt: string;
}

export interface ReorderProductPhotosAdminBody {
  publicIds: string[];
}

export interface DeleteProductPhotoAdminBody {
  publicId: string;
}

export interface ProductMediaValidationResult<T> {
  value?: T;
  errorMessage?: string;
}

const publicId = Joi.string().trim().min(1).max(500);

const completePhotoSchema = Joi.object({
  publicId: publicId.required(),
  alt: Joi.string().trim().max(180).allow('').optional(),
}).unknown(false);

const updatePhotoAltSchema = Joi.object({
  publicId: publicId.required(),
  alt: Joi.string().trim().min(1).max(180).required(),
}).unknown(false);

const reorderPhotosSchema = Joi.object({
  publicIds: Joi.array()
    .items(publicId.required())
    .max(10)
    .required(),
}).unknown(false);

const deletePhotoSchema = Joi.object({
  publicId: publicId.required(),
}).unknown(false);

const validate = <T>(
  schema: Joi.ObjectSchema,
  input: unknown
): ProductMediaValidationResult<T> => {
  const { value, error } = schema.validate(input, {
    abortEarly: false,
    convert: true,
  });

  if (error) {
    return {
      errorMessage: error.details[0]?.message ?? 'Invalid request body',
    };
  }

  return {
    value: value as T,
  };
};

export const validateCompleteProductPhotoAdminBody = (
  input: unknown
): ProductMediaValidationResult<CompleteProductPhotoAdminBody> =>
  validate(completePhotoSchema, input);

export const validateUpdateProductPhotoAltAdminBody = (
  input: unknown
): ProductMediaValidationResult<UpdateProductPhotoAltAdminBody> =>
  validate(updatePhotoAltSchema, input);

export const validateReorderProductPhotosAdminBody = (
  input: unknown
): ProductMediaValidationResult<ReorderProductPhotosAdminBody> =>
  validate(reorderPhotosSchema, input);

export const validateDeleteProductPhotoAdminBody = (
  input: unknown
): ProductMediaValidationResult<DeleteProductPhotoAdminBody> =>
  validate(deletePhotoSchema, input);
