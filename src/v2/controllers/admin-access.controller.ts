import {Types} from 'mongoose';
import {AdminAccessModel,ADMIN_PERMISSIONS} from '../models/admin-access.model';
import {getAdminOwnerIds} from '../middleware/admin.middleware';
import type {HttpHandler} from '../types/http';
const User=require('../../../models/user');
const fields='_id email firstName lastName';
const userView=(u:any)=>({id:String(u._id),email:u.email||'',name:[u.firstName,u.lastName].filter(Boolean).join(' ')});
export const adminAccess:HttpHandler=(req,res)=>{
 res.setHeader?.('Cache-Control','private, no-store');
 return res.status(200).json({owner:req.adminOwner===true,permissions:req.adminPermissions??[]});
};
export function administrators(action:'list'|'lookup'|'save'):HttpHandler{return async(req,res,next)=>{
 res.setHeader?.('Cache-Control','private, no-store');res.setHeader?.('Vary','Authorization');
 const fail=(status:number,code:string)=>res.status(status).json({error:{code,message:code}});
 try{
  // Defense in depth: delegation cannot create more grant managers.
  if(!req.adminOwner||!req.authenticatedUserId)return fail(403,'ADMIN_FORBIDDEN');
  const owners=await getAdminOwnerIds();
  if(action==='lookup'){
   const email=(req.body as any)?.email;
   if(typeof email!=='string'||email.length>254||!/^\S+@\S+\.\S+$/.test(email.trim()))return fail(400,'VALIDATION_ERROR');
   const u=await User.findOne({email:email.trim().toLowerCase()}).select(fields).lean().exec();
   if(!u)return fail(404,'USER_NOT_FOUND');
   const grant=await AdminAccessModel.findById(u._id).lean().exec();
   return res.status(200).json({...userView(u),owner:owners.has(String(u._id)),permissions:owners.has(String(u._id))?[...ADMIN_PERMISSIONS]:grant?.permissions??[],revision:grant?.revision??0});
  }
  if(action==='list'){
   const raw=req.query?.page??'1';if(typeof raw!=='string'||!/^\d{1,5}$/.test(raw)||Number(raw)<1)return fail(400,'VALIDATION_ERROR');
   const page=Number(raw),limit=20;
   const [grants,total,ownerUsers]=await Promise.all([
    AdminAccessModel.find({}).sort({_id:1}).skip((page-1)*limit).limit(limit).lean().exec(),AdminAccessModel.countDocuments({}).exec(),
    User.find({_id:{$in:[...owners].map(id=>new Types.ObjectId(id))}}).select(fields).lean().exec(),
   ]);
   const users=await User.find({_id:{$in:grants.map((g:any)=>g._id)}}).select(fields).lean().exec();
   return res.status(200).json({owners:ownerUsers.map((u:any)=>({...userView(u),owner:true,permissions:[...ADMIN_PERMISSIONS],revision:0})),items:grants.filter((g:any)=>!owners.has(String(g._id))).map((g:any)=>{const u=users.find((u:any)=>String(u._id)===String(g._id));return {...(u?userView(u):{id:String(g._id),email:'',name:'Odstraněný účet'}),owner:false,permissions:g.permissions,revision:g.revision};}),total,page,limit});
  }
  const id=req.params?.userId,body=req.body as any;
  if(!id||!/^[a-f0-9]{24}$/i.test(id)||!body||Object.keys(body).some(k=>!['permissions','revision'].includes(k))||!Number.isSafeInteger(body.revision)||body.revision<0||!Array.isArray(body.permissions)||body.permissions.length>ADMIN_PERMISSIONS.length||new Set(body.permissions).size!==body.permissions.length||body.permissions.some((p:any)=>!ADMIN_PERMISSIONS.includes(p)))return fail(400,'VALIDATION_ERROR');
  if(owners.has(id.toLowerCase()))return fail(409,'OWNER_PROTECTED');
  if(!await User.exists({_id:new Types.ObjectId(id)}))return fail(404,'USER_NOT_FOUND');
  const permissions=[...body.permissions].sort(),audit={by:req.authenticatedUserId.toHexString(),at:new Date(),permissions};
  try{
   if(body.revision===0)await AdminAccessModel.create({_id:new Types.ObjectId(id),permissions,revision:1,audit:[audit]});
   else{const result=await AdminAccessModel.updateOne({_id:new Types.ObjectId(id),revision:body.revision},{$set:{permissions},$inc:{revision:1},$push:{audit:{$each:[audit],$slice:-100}}}).exec();if(!result.modifiedCount)return fail(409,'ACCESS_CONFLICT');}
  }catch(e){if((e as any).code===11000)return fail(409,'ACCESS_CONFLICT');throw e;}
  return res.status(200).json({ok:true,revision:body.revision+1});
 }catch(e){return next(e);}
};}
