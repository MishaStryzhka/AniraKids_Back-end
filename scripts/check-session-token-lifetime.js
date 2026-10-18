const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createRequire} = require('node:module');
const jwt = require('jsonwebtoken');
const secret = 'disposable-session-lifetime-fixture';
process.env.SECRET_KEY = secret;
const ttl = 30 * 24 * 60 * 60;
function check(token) {
  const payload = jwt.verify(token, secret);
  assert.equal(payload.exp - payload.iat, ttl);
  jwt.verify(token, secret, {clockTimestamp: payload.iat + 24 * 60 * 60});
  jwt.verify(token, secret, {clockTimestamp: payload.exp - 1});
  assert.throws(() => jwt.verify(token, secret, {clockTimestamp: payload.exp}), {name: 'TokenExpiredError'});
}
function load(relative, overrides = {}) {
  const filename = path.resolve(__dirname, '..', relative), localRequire = createRequire(filename);
  const context = {module:{exports:{}},process:{env:{SECRET_KEY:secret,GOOGLE_CLIENT_ID:'fixture',SEZNAM_CLIENT_ID:'fixture',SEZNAM_CLIENT_SECRET:'fixture',FRONTEND_URL:'https://example.test'}}};
  context.require = name => name in overrides ? overrides[name] : localRequire(name);
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),context);
  return context.module.exports;
}
(async()=>{
  const user = {_id:'111111111111111111111111',tokens:[],googleId:'fixture-sub',seznamEmail:'fixture@example.test',save:async()=>{}};
  const headers = {'user-agent':'lifetime-fixture'};
  const createSession = require('../helpers/createUserSession');
  // Password login and registration share this actual issuer.
  const session = await createSession(user,{headers});check(session);
  assert.ok(jwt.decode(session).jti);
  assert.equal(user.tokens[0].token,session);
  let legacyToken;
  const User = {findOne:async()=>user,findByIdAndUpdate:async(_id,{token})=>{legacyToken=token;}};
  const common = {'../../models':{User},'../../helpers/publicUser':()=>({}),'../../helpers':{HttpError:(status,message)=>Object.assign(new Error(message),{status})}};
  const google = load('controllers/auth/authByGoogle.js',{...common,'../../helpers/verifyGoogleCredential':async()=>({sub:'fixture-sub',email:'fixture@example.test'})});
  const seznam = load('controllers/auth/authBySeznam.js',{...common,axios:{default:{post:async()=>({data:{access_token:'provider-fixture'}}),get:async()=>({data:{email:'fixture@example.test'}})}}});
  for(const handler of [google,seznam]) {
    let output;
    const response={set:()=>{},status:()=>response,json:value=>{output=value;}};
    await handler({headers,body:{credential:'provider-fixture',code:'provider-code',redirect_uri:'https://anirakids.cz'}},response);
    check(output.token);
    assert.ok(user.tokens.some(item=>item.token===output.token));
  }
  const legacy = load('controllers/auth/googleAuth.js',common);
  await legacy({user},{redirect:url=>{check(new URL(url).searchParams.get('accessToken'));}});
  check(legacyToken);
  const oldToken=jwt.sign({id:user._id},secret,{expiresIn:'23h'});
  assert.throws(()=>jwt.verify(oldToken,secret,{clockTimestamp:jwt.decode(oldToken).iat+24*60*60}),{name:'TokenExpiredError'});
  console.log('PASS: all session issuers use 30 days, valid after 24h, expire exactly at 30 days; existing tokens retain their expiry');
})().catch(error=>{console.error(error);process.exitCode=1;});
