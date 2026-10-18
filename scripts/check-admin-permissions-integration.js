const assert=require('node:assert/strict');
const {AdminAccessModel}=require('../build/v2/models/admin-access.model');
const User=require('../models/user');
module.exports=async({test,registry,insertOwned})=>{
 registry.set(AdminAccessModel,[]);if(!registry.has(User))registry.set(User,[]);
 const ids=[],keys=['V2_ADMIN_API_ENABLED','V2_ADMIN_USER_IDS','SECRET_KEY'],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));let server;
 try{
  process.env.V2_ADMIN_API_ENABLED='true';process.env.SECRET_KEY='isolated-permissions-test';
  const owner=await insertOwned(User,{email:'owner-permissions@example.test',firstName:'Owner'}),staff=await insertOwned(User,{email:'staff-permissions@example.test',firstName:'Staff',password:'never-return',seznamEmail:'secret',tokens:[]}),customer=await insertOwned(User,{email:'customer-permissions@example.test'});ids.push(owner,staff,customer);registry.get(AdminAccessModel).push(staff);
  process.env.V2_ADMIN_USER_IDS=String(owner);
  const jwt=require('jsonwebtoken'),tokens=[];
  for(const id of ids){const token=jwt.sign({id:String(id)},process.env.SECRET_KEY);tokens.push(token);await User.collection.updateOne({_id:id},{$set:{tokens:[{token}]}});}
  const express=require('express'),{createV2Router}=require('../build/v2/routes');const app=express();app.use(express.json());app.use('/api/v2',createV2Router(express,{ensureMongoConnection:(_q,_r,next)=>next()}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port+'/api/v2';
  const request=async(path,token,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
  const save=(token,permissions,revision)=>request('/admin/administrators/'+staff,token,'PATCH',{permissions,revision});
  await test('Admin permissions: owner lookup exposes only identity, exact email and protected owner',async()=>{
   assert.equal((await request('/admin/access')).status,401);
   assert.equal((await request('/admin/access',tokens[2])).status,403);
   const access=await request('/admin/access',tokens[0]);assert.equal(access.body.owner,true);assert.equal(access.body.permissions.length,5);
   const lookup=await request('/admin/administrators/lookup',tokens[0],'POST',{email:' STAFF-PERMISSIONS@example.test '});assert.equal(lookup.status,200);assert.equal(lookup.body.id,String(staff));assert.equal(lookup.body.password,undefined);assert.equal(lookup.body.tokens,undefined);assert.equal(lookup.body.seznamEmail,undefined);
   assert.equal((await request('/admin/administrators/lookup',tokens[0],'POST',{email:'missing@example.test'})).status,404);
   assert.equal((await request('/admin/administrators/'+owner,tokens[0],'PATCH',{permissions:[],revision:0})).status,409);
   assert.equal((await save(tokens[0],['invalid'],0)).status,400);
   assert.equal((await save(tokens[0],['products','products'],0)).status,400);
  });
  await test('Admin permissions: grants take effect immediately and every unrelated route rejects staff',async()=>{
   assert.equal((await save(tokens[0],['products'],0)).status,200);
   const access=await request('/admin/access',tokens[1]);assert.deepEqual(access.body,{owner:false,permissions:['products']});
   assert.equal((await request('/admin/products',tokens[1])).status,200);
   const routes=[];const router={};for(const method of ['get','post','patch','delete'])router[method]=(path,...handlers)=>{routes.push({method,path});return router;};
   require('../build/v2/routes/admin.routes').registerAdminRoutes(router,{ensureMongoConnection:(_q,_r,next)=>next()});
   for(const {path,method} of routes.filter(r=>/^\/admin\/(?:settings|fitting|overview|reservation|administrators)/.test(r.path))){const actual=path.replace(/:[A-Za-z]+/g,String(staff));const result=await request(actual,tokens[1],method.toUpperCase(),method==='get'?undefined:{});assert.equal(result.status,403,method+' '+path);}
   assert.equal((await save(tokens[1],['products','settings'],1)).status,403);
   const list=await request('/admin/administrators',tokens[0]);assert.ok(list.body.items.some(x=>x.id===String(staff)));assert.ok(list.body.owners.some(x=>x.id===String(owner)));
  });
  await test('Admin permissions: partner delegation does not grant administrator management and revokes immediately',async()=>{
   assert.equal((await request('/partner/access',tokens[1])).status,403);
   await AdminAccessModel.updateOne({_id:staff},{$set:{permissions:['partners']}});
   const access=await request('/partner/access',tokens[1]);assert.equal(access.status,200);assert.equal(access.body.owner,false);assert.equal(access.body.managePartners,true);
   assert.equal((await request('/admin/administrators',tokens[1])).status,403);
   assert.equal((await request('/admin/settings',tokens[1])).status,403);
   await AdminAccessModel.updateOne({_id:staff},{$set:{permissions:['products']}});
   assert.equal((await request('/partner/access',tokens[1])).status,403);
  });
  await test('Admin permissions: primary owner email requires verification and is protected',async()=>{
   await User.collection.updateOne({_id:customer},{$set:{email:'mykhailo.stryzhka@seznam.cz',emailVerified:false}});
   assert.equal((await request('/admin/access',tokens[2])).status,403);
   await User.collection.updateOne({_id:customer},{$set:{emailVerified:true}});
   assert.equal((await request('/admin/access',tokens[2])).body.owner,true);
   assert.equal((await request('/partner/access',tokens[2])).body.owner,true);
   assert.equal((await request('/admin/administrators/'+customer,tokens[0],'PATCH',{permissions:[],revision:0})).status,409);
   await User.collection.updateOne({_id:customer},{$set:{email:'customer-permissions@example.test',emailVerified:false}});
  });
  await test('Admin permissions: stale writes cannot override changes, revocation blocks the next request',async()=>{
   const writes=await Promise.all([save(tokens[0],['fittings'],1),save(tokens[0],['settings'],1)]);assert.deepEqual(writes.map(x=>x.status).sort(),[200,409]);
   assert.equal((await save(tokens[0],['fittings'],2)).status,200);
   assert.equal((await request('/admin/settings',tokens[1])).status,403);
   assert.equal((await request('/admin/fittings/'+staff+'/actions',tokens[1],'POST',{action:'credit',revision:0,reservationNumber:'AK-2030-ABC123'})).status,403);
   assert.equal((await save(tokens[0],[],3)).status,200);
   assert.equal((await request('/admin/access',tokens[1])).status,403);
   assert.equal((await request('/admin/products',tokens[1])).status,403);
   const saved=await AdminAccessModel.findById(staff).lean();assert.equal(saved.revision,4);assert.equal(saved.audit.length,4);assert.equal(saved.audit[3].by,String(owner));
   assert.equal((await request('/admin/access',tokens[0])).status,200);
  });
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await User.collection.deleteMany({_id:{$in:ids}});await AdminAccessModel.deleteMany({_id:{$in:ids}});for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
};
