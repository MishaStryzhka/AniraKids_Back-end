import { createHmac, timingSafeEqual } from 'crypto';
import { PartnerModel, PartnerMemberModel } from '../models/partner.model';
export interface PartnerAttribution {
  partnerId: string;
  source: 'anirak' | 'partner';
  referralCode?: string;
  staffId?: string;
  createdBy?: string;
  version: number;
}
export class PartnerError extends Error {
  constructor(
    public code: string,
    public status = 400
  ) {
    super(code);
  }
}
const sign = (body: string) => {
  const secret = process.env.SECRET_KEY;
  if (!secret) throw new PartnerError('PARTNER_UNAVAILABLE', 503);
  return createHmac('sha256', secret)
    .update('partner-referral:v1:' + body)
    .digest('base64url');
};
export async function issueReferral(code: string, now = Date.now()) {
  if (!/^[a-z0-9-]{2,80}$/.test(code))
    throw new PartnerError('REFERRAL_NOT_FOUND', 404);
  const member =
    code === 'blaze'
      ? null
      : ((await PartnerMemberModel.findOne({ referralCode: code, active: true })
          .lean()
          .exec()) as any);
  if (code !== 'blaze' && !member)
    throw new PartnerError('REFERRAL_NOT_FOUND', 404);
  const partnerId = member?.partnerId || 'blaze';
  const partner = (await PartnerModel.findOne({ _id: partnerId, enabled: true })
    .lean()
    .exec()) as any;
  if (!partner) throw new PartnerError('REFERRAL_NOT_FOUND', 404);
  const expiresAt = now + 30 * 86400000;
  const body = Buffer.from(
    JSON.stringify({
      partnerId,
      code,
      staffId: member ? String(member.userId) : undefined,
      expiresAt,
    })
  ).toString('base64url');
  return { token: body + '.' + sign(body), expiresAt, name: partner.name };
}
export async function resolveReferral(
  token?: string,
  now = Date.now()
): Promise<PartnerAttribution | undefined> {
  if (!token) return undefined;
  if (typeof token !== 'string' || token.length > 1200)
    throw new PartnerError('INVALID_REFERRAL');
  const [body, signature, ...extra] = token.split('.'),
    expected = sign(body || '');
  if (
    extra.length ||
    !signature ||
    signature.length !== expected.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new PartnerError('INVALID_REFERRAL');
  let data: any;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    throw new PartnerError('INVALID_REFERRAL');
  }
  if (!Number.isSafeInteger(data.expiresAt) || data.expiresAt <= now)
    return undefined;
  const partner = await PartnerModel.exists({
    _id: data.partnerId,
    enabled: true,
  });
  if (!partner) return undefined;
  if (
    data.staffId &&
    !(await PartnerMemberModel.exists({
      partnerId: data.partnerId,
      userId: data.staffId,
      active: true,
      referralCode: data.code,
    }))
  )
    return undefined;
  return {
    partnerId: data.partnerId,
    source: 'partner',
    referralCode: data.code,
    staffId: data.staffId,
    version: 1,
  };
}
export async function resolveBookingPartner(
  token?: string
): Promise<PartnerAttribution | undefined> {
  const referral = await resolveReferral(token);
  if (referral) return referral;
  return (await PartnerModel.exists({ _id: 'blaze', enabled: true }))
    ? { partnerId: 'blaze', source: 'anirak', version: 1 }
    : undefined;
}
