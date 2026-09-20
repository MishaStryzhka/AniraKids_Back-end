import { randomUUID } from 'crypto';

import type {
  ProductPhoto,
  ProductStatus,
} from '../types/domain';

export const MAX_PRODUCT_PHOTOS = 10;
export const MAX_PRODUCT_IMAGE_BYTES = 15 * 1024 * 1024;
export const PRODUCT_MEDIA_ROOT_FOLDER = 'AniraKids_Products/v2';
export const PRODUCT_MEDIA_ALLOWED_FORMATS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
] as const;

export const buildProductMediaFolder = (
  productId: string,
  rootFolder = PRODUCT_MEDIA_ROOT_FOLDER
): string => `${rootFolder}/${productId}`;

export const generateProductMediaAssetBasename = (): string =>
  randomUUID();

export const isPublicIdInProductFolder = (
  publicId: string,
  folder: string
): boolean => {
  const prefix = `${folder}/`;

  if (!publicId.startsWith(prefix)) {
    return false;
  }

  const basename = publicId.slice(prefix.length);
  return basename.length > 0 && !basename.includes('/');
};

export const normalizeProductPhotoAlt = (
  alt: string | undefined,
  productName: string
): string => {
  const normalized = alt?.trim();

  return normalized && normalized.length > 0
    ? normalized
    : productName.trim();
};

export const hasReachedProductPhotoLimit = (
  photoCount: number
): boolean => photoCount >= MAX_PRODUCT_PHOTOS;

export const hasProductPhoto = (
  photos: ProductPhoto[],
  publicId: string
): boolean => photos.some(photo => photo.publicId === publicId);

export const reorderProductPhotosExact = (
  photos: ProductPhoto[],
  publicIds: string[]
): ProductPhoto[] | undefined => {
  if (photos.length !== publicIds.length) {
    return undefined;
  }

  const requested = new Set(publicIds);

  if (requested.size !== publicIds.length) {
    return undefined;
  }

  const byPublicId = new Map(
    photos.map(photo => [photo.publicId, photo] as const)
  );

  if (byPublicId.size !== photos.length) {
    return undefined;
  }

  const reordered: ProductPhoto[] = [];

  for (const publicId of publicIds) {
    const photo = byPublicId.get(publicId);

    if (!photo) {
      return undefined;
    }

    reordered.push(photo);
  }

  return reordered;
};

export const canRemoveProductPhoto = (
  status: ProductStatus,
  photoCount: number
): boolean => status !== 'active' || photoCount > 1;
