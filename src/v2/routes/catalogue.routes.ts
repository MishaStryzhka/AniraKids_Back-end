import Joi = require('joi');
import { PRODUCT_CATEGORIES } from '../types/domain';
import type { HttpHandler, HttpErrorHandler, RouterLike } from '../types/http';
import {
  PublicCatalogueError,
  publicCatalogueService,
  type PublicCatalogueQuery,
  type PublicAvailabilityQuery,
} from '../services/public-catalogue.service';

const integerQuery = (maximum: number, fallback: number) =>
  Joi.string()
    .pattern(/^[1-9]\d*$/)
    .custom((value: string, helpers) => {
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed <= maximum
        ? value
        : helpers.error('any.invalid');
    })
    .default(String(fallback));

const listSchema = Joi.object({
  category: Joi.string().valid(...PRODUCT_CATEGORIES),
  q: Joi.string().max(100).allow(''),
  sort: Joi.string().valid('name', 'newest').default('name'),
  page: integerQuery(10000, 1),
  limit: integerQuery(24, 12),
}).unknown(false);
const availabilitySchema = Joi.object({
  variantId: Joi.string()
    .pattern(/^[a-f\d]{24}$/i)
    .required(),
  rentalMode: Joi.string().valid('studio', 'external').required(),
  startDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
  endDate: Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .required(),
}).unknown(false);

export const parseCatalogueQuery = (input: unknown): PublicCatalogueQuery => {
  const { value, error } = listSchema.validate(input ?? {}, { convert: false });
  if (error) throw new PublicCatalogueError(400, 'VALIDATION_ERROR');
  return {
    ...value,
    ...(value.q === undefined ? {} : { q: value.q.trim() }),
    page: Number(value.page),
    limit: Number(value.limit),
  };
};
export const parseAvailabilityQuery = (
  input: unknown
): PublicAvailabilityQuery => {
  const { value, error } = availabilitySchema.validate(input ?? {}, {
    convert: false,
  });
  if (error) throw new PublicCatalogueError(400, 'VALIDATION_ERROR');
  return value;
};

const validate: HttpHandler = (request, _response, next) => {
  try {
    if (request.params?.productId !== undefined) {
      if (!/^[a-f\d]{24}$/i.test(request.params.productId))
        throw new PublicCatalogueError(400, 'VALIDATION_ERROR');
      parseAvailabilityQuery(request.query);
    } else if (request.params?.slug !== undefined) {
      if (
        request.params.slug.length > 160 ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.params.slug)
      )
        throw new PublicCatalogueError(404, 'PRODUCT_NOT_FOUND');
      if (Object.keys(request.query ?? {}).length)
        throw new PublicCatalogueError(400, 'VALIDATION_ERROR');
    } else parseCatalogueQuery(request.query);
    return next();
  } catch (error) {
    return next(error);
  }
};

export const registerCatalogueRoutes = (
  router: RouterLike,
  dependencies: { ensureMongoConnection: HttpHandler }
): void => {
  router.get(
    '/catalogue/products',
    validate,
    dependencies.ensureMongoConnection,
    async (request, response, next) => {
      try {
        return response
          .status(200)
          .json(
            await publicCatalogueService.list(
              parseCatalogueQuery(request.query)
            )
          );
      } catch (error) {
        return next(error);
      }
    }
  );
  router.get(
    '/catalogue/products/:productId/availability',
    validate,
    dependencies.ensureMongoConnection,
    async (request, response, next) => {
      try {
        return response
          .status(200)
          .json(
            await publicCatalogueService.availability(
              request.params!.productId!,
              parseAvailabilityQuery(request.query)
            )
          );
      } catch (error) {
        return next(error);
      }
    }
  );
  router.get(
    '/catalogue/products/:slug',
    validate,
    dependencies.ensureMongoConnection,
    async (request, response, next) => {
      try {
        return response
          .status(200)
          .json(await publicCatalogueService.detail(request.params!.slug!));
      } catch (error) {
        return next(error);
      }
    }
  );
};

export const catalogueApiErrorHandler: HttpErrorHandler = (
  error,
  _request,
  response,
  _next
) => {
  const known = error instanceof PublicCatalogueError;
  return response.status(known ? error.status : 500).json({
    error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known
        ? 'Catalogue request could not be completed'
        : 'Catalogue is temporarily unavailable',
    },
  });
};
