import vm from 'node:vm';
import {createHapoalimSessionAdapter} from '../netunim-kupa/bank-bridge/hapoalim-session.mjs';
export function sessionFixture({saved='',terminal=async()=>({resultKey:'SUCCESS'})}={}){
  const calls=[];let now=0;
  const clock={now:()=>now,delay:async ms=>{calls.push(['delay',ms]);now+=ms}};
  const api=createHapoalimSessionAdapter({metadata:{read:async()=>({sessionUrl:saved})},clock,waitForTerminal:async(page,results,options)=>{calls.push(['terminal',results,options]);return terminal(page,results,options)}});
  return {api,calls,clock};
}
export function browserPage({href='https://login.bankhapoalim.co.il/unfamiliar',restContext='fixture',status=200,text='[]'}={}){
  return {isClosed:()=>false,evaluate:async callback=>vm.runInNewContext('('+callback.toString()+')()',{
    window:{location:{href,origin:'https://login.bankhapoalim.co.il'},bnhpApp:{restContext}},fetch:async()=>({ok:status>=200&&status<300,status,text:async()=>text})
  })};
}
