export interface RevolutAttempt {
  id:string;
  kind:'advance'|'full';
  amount:number;
  rentalAmount:number;
  depositAmount:number;
  expiresAt:Date;
  state:'creating'|'pending'|'completed'|'cancelled'|'failed';
  orderId?:string;
  token?:string;
  reviewRequired?:boolean;
}
