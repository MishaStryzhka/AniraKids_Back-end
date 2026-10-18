import {model,models,Schema} from 'mongoose';
export const ADMIN_PERMISSIONS=['products','reservations','fittings','settings','partners'] as const;
export type AdminPermission=typeof ADMIN_PERMISSIONS[number];
const schema=new Schema({
 _id:{type:Schema.Types.ObjectId,required:true},
 permissions:[{type:String,enum:ADMIN_PERMISSIONS}],
 revision:{type:Number,required:true,default:1},
 audit:[{_id:false,by:String,at:Date,permissions:[String]}],
},{collection:'v2_admin_access',timestamps:true,strict:'throw'});
export const AdminAccessModel=models.AdminAccess??model('AdminAccess',schema);
