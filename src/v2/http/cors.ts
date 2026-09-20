export interface V2CorsOptions {
  origin: (
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void
  ) => void;
  methods: string[];
  allowedHeaders: string[];
  optionsSuccessStatus: number;
}

export const parseV2CorsAllowedOrigins = (
  rawValue = process.env.V2_CORS_ALLOWED_ORIGINS
): Set<string> =>
  new Set(
    (rawValue ?? '')
      .split(',')
      .map(value => value.trim())
      .filter(value => value.length > 0)
  );

export const createV2CorsOptions = (
  rawValue = process.env.V2_CORS_ALLOWED_ORIGINS
): V2CorsOptions => {
  const allowedOrigins = parseV2CorsAllowedOrigins(rawValue);

  return {
    origin: (origin, callback) => {
      if (origin === undefined || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
    ],
    optionsSuccessStatus: 204,
  };
};
