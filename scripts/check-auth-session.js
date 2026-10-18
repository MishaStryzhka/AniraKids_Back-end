const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
let invalid = false, outage = false, user;
const context = {module:{exports:{}},process:{env:{SECRET_KEY:'fixture'}},require(name){
 if(name==='jsonwebtoken')return {verify(){if(invalid)throw new Error('expired');return {id:'fixture-user'};}};
 if(name==='../models')return {User:{async findById(){if(outage)throw new Error('database unavailable');return user;}}};
 if(name==='../helpers')return {HttpError:(status,message)=>Object.assign(new Error(message),{status})};
 throw new Error(name);
}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../middlewares/authenticate.js'),'utf8'),context);
async function check(status){let error;const request={headers:{authorization:'Bearer fixture'}};await context.module.exports(request,{},value=>{error=value;});assert.equal(error?.status,status);if(!status)assert.equal(request.user,user);}
(async()=>{
 user={tokens:[{token:'fixture'}]};await check(undefined);
 outage=true;await check(503);outage=false;
 invalid=true;await check(401);invalid=false;
 user={tokens:[]};await check(401);user=null;await check(401);
 console.log('Authentication session regression checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
