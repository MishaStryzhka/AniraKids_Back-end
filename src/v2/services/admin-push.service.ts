import {createHash, createPrivateKey, ECDH, sign} from 'crypto';
import {Types} from 'mongoose';
import {generateRequestDetails} from 'web-push';
import {AdminPushSubscriptionModel} from '../models/admin-push-subscription.model';

export const PUSH_TOPICS = ['fitting_created', 'fitting_payment_reported'] as const;
export type PushTopic = typeof PUSH_TOPICS[number];
export function parsePushTopics(input: unknown): PushTopic[] | null {
  if (!Array.isArray(input) || input.length > PUSH_TOPICS.length || new Set(input).size !== input.length ||
      !input.every(v => typeof v === 'string' && PUSH_TOPICS.includes(v as PushTopic))) return null;
  return [...new Set(input)] as PushTopic[];
}

export type PushKeys = {p256dh: string; auth: string};
export function validPushKeys(value: unknown): value is PushKeys {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = value as PushKeys;
  if (Object.keys(keys).some(key => !['p256dh', 'auth'].includes(key)) ||
      typeof keys.p256dh !== 'string' || !/^[A-Za-z0-9_-]{87}$/.test(keys.p256dh) ||
      typeof keys.auth !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(keys.auth)) return false;
  try {
    const point = Buffer.from(keys.p256dh, 'base64url');
    return point.length === 65 && point[0] === 4 && Buffer.from(keys.auth, 'base64url').length === 16 &&
      ECDH.convertKey(point, 'prime256v1').length === 65;
  } catch { return false; }
}

// Encrypt only the event type; never include customer, booking or payment details.
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

export async function registerOwnerPush(ownerId: Types.ObjectId, endpoint: string, topics: PushTopic[] = ['fitting_payment_reported'], keys?: PushKeys) {
  if (!validPushEndpoint(endpoint)) throw new Error('INVALID_PUSH_ENDPOINT');
  if ((keys !== undefined && !validPushKeys(keys)) || (topics.includes('fitting_created') && !keys)) throw new Error('INVALID_PUSH_KEYS');
  const existing = await AdminPushSubscriptionModel.countDocuments({ownerId}).exec();
  const endpointHash = hashEndpoint(endpoint);
  const previous = await AdminPushSubscriptionModel.findOne({endpointHash}).select('ownerId').lean().exec();
  if (previous && String(previous.ownerId) !== String(ownerId)) throw new Error('PUSH_OWNER_CONFLICT');
  if (existing >= 10 && !await AdminPushSubscriptionModel.exists({ownerId, endpointHash})) {
    throw new Error('PUSH_DEVICE_LIMIT');
  }
  await AdminPushSubscriptionModel.updateOne({endpointHash},
    {$set: {endpoint, ownerId, topics, ...(keys ? {keys} : {})}}, {upsert: true}).exec();
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

async function deliver(subscription: {endpoint: string; endpointHash: string; keys?: PushKeys}, config: ReturnType<typeof pushVapidConfig>, topic: PushTopic) {
  // Validate database data on every send: never make arbitrary network requests.
  if (!validPushEndpoint(subscription.endpoint)) return;
  try {
    // Old devices keep their original payment alert until upgraded in Settings.
    const encrypted = validPushKeys(subscription.keys);
    if (!encrypted && topic !== 'fitting_payment_reported') return;
    const details = encrypted ? generateRequestDetails({endpoint: subscription.endpoint, keys: subscription.keys!},
      JSON.stringify({type: topic}), {vapidDetails: {subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey},
        TTL: 3600, urgency: 'high', contentEncoding: 'aes128gcm'}) : null;
    const response = await fetch(subscription.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: details ? Object.fromEntries(Object.entries(details.headers).map(([key, value]) => [key, String(value)])) : {
        Authorization: makeAuthorization(subscription.endpoint, config),
        TTL: '3600',
        Urgency: 'high',
        'Content-Length': '0',
      },
      ...(details ? {body: details.body} : {}),
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

async function notifyOwner(topic: PushTopic) {
  const config = pushVapidConfig();
  if (!config.enabled) return;
  try {
    // Preserve legacy subscriptions without the topics field as opted into the original alert.
    const filter = topic === 'fitting_payment_reported'
      ? {$or: [{topics: topic}, {topics: {$exists: false}}]} : {topics: topic};
    const subscriptions = await AdminPushSubscriptionModel.find(filter)
      .select('endpoint endpointHash keys').limit(50).lean().exec() as Array<{endpoint: string; endpointHash: string; keys?: PushKeys}>;
    await Promise.allSettled(subscriptions.map(subscription => deliver(subscription, config, topic)));
  } catch {
    // A successful booking/payment report must never fail because push is down.
    console.warn('FITTING_PUSH_UNAVAILABLE');
  }
}

export const notifyOwnerFittingCreated = () => notifyOwner('fitting_created');
export const notifyOwnerFittingPaymentReported = () => notifyOwner('fitting_payment_reported');
