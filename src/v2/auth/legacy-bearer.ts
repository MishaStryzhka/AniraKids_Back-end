import { Types } from 'mongoose';

interface LegacyUserAuthRecord {
  _id: Types.ObjectId;
  tokens?: Array<{
    token?: string;
  }>;
}

interface LegacyUserQuery {
  select(selection: string): LegacyUserQuery;
  lean(): LegacyUserQuery;
  exec(): Promise<LegacyUserAuthRecord | null>;
}

interface LegacyUserModelLike {
  findById(id: string): LegacyUserQuery;
}

interface JwtModuleLike {
  verify(token: string, secret: string): unknown;
}

const LegacyUserModel = require('../../../models/user') as LegacyUserModelLike;
const jwt = require('jsonwebtoken') as JwtModuleLike;

export class LegacyAuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LegacyAuthConfigurationError';
  }
}

export type BearerAuthorizationResult =
  | { kind: 'missing' }
  | { kind: 'bearer'; token: string }
  | { kind: 'invalid' };

export const parseBearerAuthorization = (
  authorization: string | string[] | undefined
): BearerAuthorizationResult => {
  if (authorization === undefined) {
    return { kind: 'missing' };
  }

  if (typeof authorization !== 'string') {
    return { kind: 'invalid' };
  }

  const match = /^Bearer ([^\s]+)$/i.exec(authorization);

  if (!match) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'bearer',
    token: match[1],
  };
};

const extractJwtUserId = (payload: unknown): string | undefined => {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('id' in payload)
  ) {
    return undefined;
  }

  const id = (payload as { id?: unknown }).id;

  if (typeof id === 'string' && Types.ObjectId.isValid(id)) {
    return id;
  }

  if (id instanceof Types.ObjectId) {
    return id.toHexString();
  }

  return undefined;
};

export interface AuthenticatedLegacyIdentity {
  userId: Types.ObjectId;
}

export const authenticateLegacyBearer = async (
  token: string
): Promise<AuthenticatedLegacyIdentity | null> => {
  const secret = process.env.SECRET_KEY;

  if (!secret) {
    throw new LegacyAuthConfigurationError(
      'JWT authentication is not configured'
    );
  }

  let userId: string;

  try {
    const payload = jwt.verify(token, secret);
    const extractedUserId = extractJwtUserId(payload);

    if (!extractedUserId) {
      return null;
    }

    userId = extractedUserId;
  } catch (_error) {
    return null;
  }

  const user = await LegacyUserModel.findById(userId)
    .select('_id tokens.token')
    .lean()
    .exec();

  const hasActiveToken =
    user?.tokens?.some(item => item.token === token) ?? false;

  if (!user || !hasActiveToken) {
    return null;
  }

  return {
    userId: user._id,
  };
};
