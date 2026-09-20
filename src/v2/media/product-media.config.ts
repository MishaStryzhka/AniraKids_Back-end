export interface ProductMediaConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export class ProductMediaConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProductMediaConfigurationError';
  }
}

type MediaEnvironment = Record<string, string | undefined>;

const requiredValue = (
  env: MediaEnvironment,
  name: 'CLOUDINARY_NAME' | 'CLOUDINARY_KEY' | 'CLOUDINARY_SECRET'
): string => {
  const value = env[name]?.trim();

  if (!value) {
    throw new ProductMediaConfigurationError(
      `${name} is not configured`
    );
  }

  return value;
};

export const getProductMediaConfig = (
  env: MediaEnvironment = process.env
): ProductMediaConfig => ({
  cloudName: requiredValue(env, 'CLOUDINARY_NAME'),
  apiKey: requiredValue(env, 'CLOUDINARY_KEY'),
  apiSecret: requiredValue(env, 'CLOUDINARY_SECRET'),
});
