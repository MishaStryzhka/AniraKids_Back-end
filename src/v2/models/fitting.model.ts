import {model,models,Schema} from 'mongoose';
const schema=new Schema({
 operationId:{type:String,required:true},requestHash:{type:String,required:true,select:false},tokenHash:{type:String,required:true,select:false},
 number:{type:String,required:true},date:{type:String,required:true},time:{type:String,required:true},startAt:{type:Date,required:true},address:{type:String,required:true},
 slotKey:String,activeEmail:String,expiresAt:Date,
 status:{type:String,enum:['pending','review','confirmed','completed','cancelled','expired'],required:true},
 paymentStatus:{type:String,enum:['unpaid','paid','refunded'],required:true},
 customer:{name:String,email:String,phone:String},product:{id:String,name:String,slug:String},
 creditOperationId:{type:String,required:true},revision:{type:Number,default:0},
 audit:[{_id:false,action:String,at:Date,by:String}],
},{collection:'v2_fittings',timestamps:true,strict:'throw'});
schema.index({operationId:1},{unique:true});schema.index({number:1},{unique:true});
schema.index({slotKey:1},{unique:true,partialFilterExpression:{slotKey:{$type:'string'}}});
schema.index({activeEmail:1},{unique:true,partialFilterExpression:{activeEmail:{$type:'string'}}});
schema.index({date:1,time:1});
export const FittingModel=models.Fitting ?? model('Fitting',schema);
