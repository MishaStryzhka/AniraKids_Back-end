import axios = require('axios');
import { createHmac, timingSafeEqual } from 'crypto';
import { PaymentError } from './payment.types';

export function revolutConfiguration() {
  const mode = process.env.REVOLUT_MODE;
  if (process.env.REVOLUT_ENABLED !== 'true' || !['sandbox','prod'].includes(mode ?? '') ||
      !process.env.REVOLUT_SECRET_KEY || !process.env.REVOLUT_PUBLIC_KEY || !process.env.REVOLUT_WEBHOOK_SECRET) return null;
  return { mode: mode as 'sandbox'|'prod', publicKey: process.env.REVOLUT_PUBLIC_KEY };
}
export function verifyRevolutSignature(raw: Buffer | undefined, timestamp: unknown, signature: unknown, now = Date.now()): boolean {
  const secret = process.env.REVOLUT_WEBHOOK_SECRET;
  if (!secret || !raw || typeof timestamp !== 'string' || !/^\d{13}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp)) > 300000 || typeof signature !== 'string' || signature.length > 1024) return false;
  const expected = createHmac('sha256',secret).update(`v1.${timestamp}.`).update(raw).digest();
  return signature.split(',').some(value => /^v1=[a-f0-9]{64}$/.test(value.trim()) &&
    timingSafeEqual(expected,Buffer.from(value.trim().slice(3),'hex')));
}
export interface RevolutOrder { id:string; token:string; state:string; amount:number; currency:string; merchant_order_data?:{reference?:string}; }
export async function revolutRequest(method:'GET'|'POST', path:string, body?:unknown): Promise<RevolutOrder> {
  // Reconciliation remains available when checkout is disabled (kill switch).
  if (!process.env.REVOLUT_SECRET_KEY || !['prod','sandbox'].includes(process.env.REVOLUT_MODE ?? ''))
    throw new PaymentError('REVOLUT_UNAVAILABLE',503);
  const host = process.env.REVOLUT_MODE === 'prod' ? 'https://merchant.revolut.com' : 'https://sandbox-merchant.revolut.com';
  try {
    const response = await axios.default.request({method,url:host+'/api'+path,data:body,timeout:12000,maxRedirects:0,
      headers:{Authorization:`Bearer ${process.env.REVOLUT_SECRET_KEY}`,'Revolut-Api-Version':'2026-08-17','Content-Type':'application/json'}});
    return response.data as RevolutOrder;
  } catch {
    // Never leak Axios errors: they contain the secret authorization header.
    throw new PaymentError('REVOLUT_UNAVAILABLE',503);
  }
}
