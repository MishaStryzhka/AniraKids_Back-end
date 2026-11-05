import { Types } from 'mongoose';
const User = require('../../../models/user');
export type ReservationOwnership = {customerId: Types.ObjectId} | {$or: Array<{customerId: Types.ObjectId} | {customerId:null; 'customerSnapshot.email':string}>};
export type ReservationAccessFilter = ReservationOwnership | {guestAccessTokenHash:string};
export async function reservationOwnership(customerId:Types.ObjectId):Promise<{filter:ReservationOwnership;guestEmailAccess:boolean}> {
 const user = await User.findById(customerId).select('email emailVerified').lean().exec();
 const email = user?.emailVerified === true && typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
 return {filter:email ? {$or:[{customerId},{customerId:null,'customerSnapshot.email':email}]} : {customerId},guestEmailAccess:Boolean(email)};
}
