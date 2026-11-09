import {Schema} from 'mongoose';
export const revolutAttemptSchema=new Schema({
      id:{type:String,required:true}, kind:{type:String,enum:['advance','full'],required:true},
      amount:{type:Number,required:true,min:1}, rentalAmount:{type:Number,required:true,min:0}, depositAmount:{type:Number,required:true,min:0},
      expiresAt:{type:Date,required:true}, state:{type:String,enum:['creating','pending','completed','cancelled','failed'],required:true},
      orderId:String, token:String, reviewRequired:Boolean,
    },{_id:false});
