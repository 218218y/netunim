import assert from 'node:assert/strict';
import {createCalendarAuth} from '../netunim-orders/site/assets/js/calendar/auth.js';

const session={accessToken:'',tokenExpiresAt:0,connected:false,accountVerified:false,accountId:'',expectedAccountId:''};
const calls=[];
let mode='token';
let assigned='';
globalThis.location={href:'https://orders.example.test/?x=1',assign(url){assigned=url}};

async function supaFetch(path,opt={}){
  const body=JSON.parse(opt.body||'{}');
  calls.push({path,body});
  if(mode==='not_connected')return new Response(JSON.stringify({code:'calendar_not_connected'}),{status:404,headers:{'Content-Type':'application/json'}});
  if(mode==='start')return new Response(JSON.stringify({authorize_url:'https://accounts.google.com/o/oauth2/v2/auth?state=test'}),{status:200,headers:{'Content-Type':'application/json'}});
  if(mode==='disconnect')return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
  return new Response(JSON.stringify({access_token:'server-token',expires_in:3600,account_id:'owner@example.com'}),{status:200,headers:{'Content-Type':'application/json'}});
}

const auth=createCalendarAuth({calendarSession:session,supaFetch});
assert.equal(auth.configured(),true);
assert.equal(auth.ready(),true);
assert.equal(await auth.restore(),'server-token');
assert.equal(calls.at(-1).body.action,'token');
assert.equal(session.connected,true);
assert.equal(session.accountId,'owner@example.com');
assert.equal(session.expectedAccountId,'owner@example.com');
assert.equal(auth.hasUsableToken(),true);

auth.clearToken();
mode='not_connected';
await assert.rejects(auth.restore(),error=>error.code==='calendar_not_connected');
assert.equal(session.connected,false);

mode='start';
await auth.beginConnect({returnUrl:'https://orders.example.test/'});
assert.equal(calls.at(-1).body.action,'start');
assert.equal(calls.at(-1).body.return_url,'https://orders.example.test/');
assert.match(assigned,/^https:\/\/accounts\.google\.com\//);

session.accessToken='short';
session.tokenExpiresAt=Date.now()+3600000;
session.connected=true;
mode='disconnect';
await auth.disconnect();
assert.equal(calls.at(-1).body.action,'disconnect');
assert.equal(session.accessToken,'');
assert.equal(session.connected,false);
console.log('CALENDAR AUTH TESTS PASSED');
