import assert from 'node:assert/strict';
import {createCalendarAuth} from '../netunim-orders/site/assets/js/calendar/auth.js';

const session={accessToken:'',tokenExpiresAt:0,connected:false,accountVerified:false};
let oauthConfig=null;
let lastRequest=null;
let behavior='access_denied';

globalThis.google={accounts:{oauth2:{
  initTokenClient(config){
    oauthConfig=config;
    return {requestAccessToken(override={}){
      lastRequest=override;
      if(behavior==='access_denied')queueMicrotask(()=>config.callback({error:'access_denied',error_description:'Access denied'}));
      else if(behavior==='popup_closed')queueMicrotask(()=>config.error_callback({type:'popup_closed'}));
      else if(behavior==='success')queueMicrotask(()=>config.callback({access_token:'token',expires_in:3600,scope:config.scope}));
    }};
  },
  hasGrantedAllScopes(){return true},
  revoke(token,callback){callback();},
}}};

globalThis.document={querySelector(){return null}};

const auth=createCalendarAuth({calendarSession:session});
await assert.rejects(auth.connect(),error=>{
  assert.equal(error.code,'access_denied');
  assert.match(error.message,/Audience/);
  assert.match(error.message,/Test users/);
  return true;
});
assert.equal(session.connected,false);
assert.equal(session.accessToken,'');

behavior='popup_closed';
await assert.rejects(auth.connect(),error=>{
  assert.equal(error.code,'popup_closed');
  assert.match(error.message,/403 access_denied/);
  assert.match(error.message,/Test users/);
  return true;
});

behavior='success';
assert.equal(auth.ready(),true);
assert.equal(await auth.connect({loginHint:'owner@example.com'}),'token');
assert.equal(lastRequest.prompt,'');
assert.equal(lastRequest.login_hint,'owner@example.com');
assert.equal(session.connected,true);
assert.equal(session.accessToken,'token');
auth.clearToken();
assert.equal(await auth.connect({loginHint:'owner@example.com',prompt:'none'}),'token');
assert.equal(lastRequest.prompt,'none');
assert.equal(lastRequest.login_hint,'owner@example.com');
console.log('CALENDAR AUTH TESTS PASSED');
