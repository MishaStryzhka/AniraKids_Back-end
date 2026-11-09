import type { FulfillmentMethod, RentalMode } from '../types/domain';
import { addCalendarDays, formatDateOnly } from './date-only';
import { getCleaningBufferDays } from './availability';
export const RENTAL_POLICY_VERSION = '2026-11' as const;
// Operational safety margin, not a carrier delivery guarantee.
export const TRANSIT_WORKING_DAYS = 2;
function holiday(date: Date): boolean {
  const md = formatDateOnly(date).slice(5);
  if (['01-01','05-01','05-08','07-05','07-06','09-28','10-28','11-17','12-24','12-25','12-26'].includes(md)) return true;
  const y=date.getUTCFullYear(),a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),n=h+l-7*m+114;
  const easter=new Date(Date.UTC(y,Math.floor(n/31)-1,n%31+1));
  return date.getTime()===addCalendarDays(easter,-2).getTime() || date.getTime()===addCalendarDays(easter,1).getTime();
}
export function shiftWorkingDays(date: Date, days: number): Date {
  let result=date;
  for(let remaining=Math.abs(days);remaining;){result=addCalendarDays(result,Math.sign(days));if(result.getUTCDay()!==0&&result.getUTCDay()!==6&&!holiday(result))remaining--;}
  return result;
}
export function occupiedRentalRange(start:Date,end:Date,mode:RentalMode,method?:FulfillmentMethod){
  const shipping=mode==='external'&&(method==='balikovna'||method==='balikovna_address');
  return {occupiedStartDate:shipping?shiftWorkingDays(start,-TRANSIT_WORKING_DAYS):start,
    // Shipped garments are cleaned on the return delivery day, which stays occupied.
    occupiedEndDate:shipping?shiftWorkingDays(end,TRANSIT_WORKING_DAYS):addCalendarDays(end,getCleaningBufferDays(mode))};
}
export function roundTripShippingPrice(mode:RentalMode,method?:FulfillmentMethod){return mode!=='external'?0:method==='balikovna'?178:method==='balikovna_address'?238:0;}
