import {createHash, createPrivateKey, sign} from 'crypto';
import {Types} from 'mongoose';
import {AdminPushSubscriptionModel} from '../models/admin-push-subscription.model';

export const PUSH_TOPICS = ['fitting_payment_reported'] as const;
export type PushTopic = typeof PUSH_TOPICS[number];
export function parsePushTopics(input: unknown): PushTopic[] | null {
  if (!Array.isArray(input) || input.length > PUSH_TOPICS.length ||
      !input.every(v => typeof v === 'string' && PUSH_TOPICS.includes(v as PushTopic))) return null;
  return [...new Set(input)] as PushTopic[];
}

// Empty-payload Web Push: no personal or payment details leave the API.
// The service worker displays a fixed Czech notification and opens the admin fittings view.
const hashEndpoint = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');
const encode = (value: Buffer | string) => Buffer.from(value).toString('base64url');
const allowedPushHost = (hostname: string) =>
  hostname === 'fcm.googleapis.com' ||
  hostname === 'fcmregistrations.googleapis.com' ||
  hostname === 'updates.push.services.mozilla.com' ||
  hostname === 'web.push.apple.com' ||
  hostname.endsWith('.push.apple.com');

export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 30 || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      (!url.port || url.port === '443') && allowedPushHost(url.hostname) &&
      url.pathname.length > 1 && !url.hash;
  } catch { return false; }
}

export function pushVapidConfig() {
  const publicKey = process.env.V2_PUSH_VAPID_PUBLIC_KEY || '';
  const privateKey = process.env.V2_PUSH_VAPID_PRIVATE_KEY || '';
  const subject = process.env.V2_PUSH_VAPID_SUBJECT || '';
  const publicBytes = Buffer.from(publicKey, 'base64url');
  const privateBytes = Buffer.from(privateKey, 'base64url');
  const enabled = /^[A-Za-z0-9_-]+$/.test(publicKey) &&
    /^[A-Za-z0-9_-]+$/.test(privateKey) &&
    publicBytes.length === 65 && publicBytes[0] === 4 &&
    privateBytes.length === 32 && /^mailto:[^@\s]+@[^@\s]+$/.test(subject);
  return {enabled, publicKey: enabled ? publicKey : '', privateKey, subject};
}

export async function registerOwnerPush(ownerId: Types.ObjectId, endpoint: string, topics: PushTopic[] = ['fitting_payment_reported']) {
  if (!validPushEndpoint(endpoint)) throw new Error('INVALID_PUSH_ENDPOINT');
  const existing = await AdminPushSubscriptionModel.countDocuments({ownerId}).exec();
  const endpointHash = hashEndpoint(endpoint);
  const previous = await AdminPushSubscriptionModel.findOne({endpointHash}).select('ownerId').lean().exec();
  if (previous && String(previous.ownerId) !== String(ownerId)) throw new Error('PUSH_OWNER_CONFLICT');
  if (existing >= 10 && !await AdminPushSubscriptionModel.exists({ownerId, endpointHash})) {
    throw new Error('PUSH_DEVICE_LIMIT');
  }
  await AdminPushSubscriptionModel.updateOne({endpointHash},
    {$set: {endpoint, ownerId, topics}}, {upsert: true}).exec();
}

export async function ownerPushPreferences(ownerId: Types.ObjectId, endpoint: string) {
  if (!validPushEndpoint(endpoint)) throw new Error('INVALID_PUSH_ENDPOINT');
  const record = await AdminPushSubscriptionModel.findOne({ownerId, endpointHash: hashEndpoint(endpoint)})
    .select('topics').lean().exec() as {topics?: string[]} | null;
  return {subscribed: Boolean(record), topics: record
    ? (record.topics === undefined ? ['fitting_payment_reported'] :
        (parsePushTopics(record.topics) || [])) : []};
}

export async function unregisterOwnerPush(ownerId: Types.ObjectId, endpoint: string) {
  if (!validPushEndpoint(endpoint)) throw new Error('INVALID_PUSH_ENDPOINT');
  await AdminPushSubscriptionModel.deleteOne({ownerId, endpointHash: hashEndpoint(endpoint)}).exec();
}

export function makeAuthorization(endpoint: string, configuration: ReturnType<typeof pushVapidConfig>) {
  const pub = Buffer.from(configuration.publicKey, 'base64url');
  const privateKey = createPrivateKey({key: {
    kty: 'EC', crv: 'P-256',
    x: pub.subarray(1, 33).toString('base64url'),
    y: pub.subarray(33, 65).toString('base64url'),
    d: configuration.privateKey,
  }, format: 'jwk'});
  const jwtHeader = encode(JSON.stringify({typ: 'JWT', alg: 'ES256'}));
  const jwtPayload = encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    sub: configuration.subject,
  }));
  const message = jwtHeader + '.' + jwtPayload;
  const signature = sign('sha256', Buffer.from(message), {key: privateKey, dsaEncoding: 'ieee-p1363'});
  return 'vapid t=' + message + '.' + signature.toString('base64url') + ', k=' + configuration.publicKey;
}

async function deliver(subscription: {endpoint: string; endpointHash: string}, config: ReturnType<typeof pushVapidConfig>) {
  // Validate database data on every send: never make arbitrary network requests.
  if (!validPushEndpoint(subscription.endpoint)) return;
  try {
    const response = await fetch(subscription.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: {
        Authorization: makeAuthorization(subscription.endpoint, config),
        TTL: '3600',
        Urgency: 'high',
        'Content-Length': '0',
      },
    });
    if (response.status === 404 || response.status === 410) {
      await AdminPushSubscriptionModel.deleteOne({endpointHash: subscription.endpointHash}).exec();
    } else if (!response.ok) {
      console.warn('FITTING_PUSH_DELIVERY_FAILED', response.status);
    }
  } catch {
    console.warn('FITTING_PUSH_DELIVERY_UNAVAILABLE');
  }
}

export async function notifyOwnerFittingPaymentReported() {
  const config = pushVapidConfig();
  if (!config.enabled) return;
  try {
    // Preserve legacy subscriptions without the topics field as opted into the original alert.
    const subscriptions = await AdminPushSubscriptionModel.find({$or: [
      {topics: 'fitting_payment_reported'}, {topics: {$exists: false}},
    ]})
      .select('endpoint endpointHash').limit(50).lean().exec() as Array<{endpoint: string; endpointHash: string}>;
    await Promise.allSettled(subscriptions.map(subscription => deliver(subscription, config)));
  } catch {
    // A successful payment report must never fail because a push service is down.
    console.warn('FITTING_PUSH_UNAVAILABLE');
  }
}
