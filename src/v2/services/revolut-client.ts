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
// Sandbox diagnostics deliberately exclude tokens, headers and payer/card data.
const diagnosticCode = (value:unknown) => typeof value==='string' && /^[a-z_]{1,64}$/.test(value) ? value : undefined;
export async function revolutRequest(method:'GET'|'POST', path:string, body?:unknown): Promise<RevolutOrder> {
  // Reconciliation remains available when checkout is disabled (kill switch).
  if (!process.env.REVOLUT_SECRET_KEY || !['prod','sandbox'].includes(process.env.REVOLUT_MODE ?? ''))
    throw new PaymentError('REVOLUT_UNAVAILABLE',503);
  const host = process.env.REVOLUT_MODE === 'prod' ? 'https://merchant.revolut.com' : 'https://sandbox-merchant.revolut.com';
  try {
    const response = await axios.default.request({method,url:host+'/api'+path,data:body,timeout:12000,maxRedirects:0,
      headers:{Authorization:`Bearer ${process.env.REVOLUT_SECRET_KEY}`,'Revolut-Api-Version':'2026-08-17','Content-Type':'application/json'}});
    if(process.env.REVOLUT_MODE==='sandbox' && method==='GET' && /^\/orders\/[a-f0-9-]{36}$/i.test(path)) {
      const order=response.data;
      console.info('revolut_sandbox_order',JSON.stringify({orderId:path.slice(8),state:diagnosticCode(order?.state),
        payments:Array.isArray(order?.payments)?order.payments.map((payment:any)=>({state:diagnosticCode(payment.state),
          reason:diagnosticCode(payment.decline_reason ?? payment.failure_reason ?? payment.payment_method?.failure_reason),
          threeDS:diagnosticCode(payment.payment_method?.checks?.three_ds?.state),
          cvv:diagnosticCode(payment.payment_method?.checks?.cvv_verification)})):[]}));
      for(const payment of Array.isArray(order?.payments)?order.payments:[]) {
        if(payment.state!=='failed' || !/^[a-f0-9-]{36}$/i.test(payment.id))continue;
        try {
          const {data:p}=await axios.default.get(host+'/api/payments/'+payment.id,{timeout:5000,maxRedirects:0,
            headers:{Authorization:`Bearer ${process.env.REVOLUT_SECRET_KEY}`,'Revolut-Api-Version':'2026-08-17'}});
          console.info('revolut_sandbox_failed_payment',JSON.stringify({paymentId:payment.id,state:diagnosticCode(p.state),
            reason:diagnosticCode(p.decline_reason ?? p.failure_reason ?? p.payment_method?.failure_reason),
            threeDS:diagnosticCode(p.payment_method?.checks?.three_ds?.state),
            fields:Object.keys(p),methodFields:Object.keys(p.payment_method??{})}));
        }catch { /* Diagnostics must not change the authoritative order result. */ }
      }
    }
    return response.data as RevolutOrder;
  } catch(error) {
    if(process.env.REVOLUT_MODE==='sandbox' && axios.default.isAxiosError(error))
      console.warn('revolut_sandbox_error',JSON.stringify({method,operation:path.endsWith('/cancel')?'cancel':'order',
        status:error.response?.status,code:diagnosticCode(error.response?.data?.code)}));
    // Never leak Axios errors: they contain the secret authorization header.
    throw new PaymentError('REVOLUT_UNAVAILABLE',503);
  }
}
