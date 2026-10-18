// Disposable native composition fixture. Browser callbacks execute against a
// synthetic Hapoalim response map; no browser or external request is created.
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
const app=path.join(process.env.LOCALAPPDATA,'NetunimKupaBankBridge');
const href='https://login.bankhapoalim.co.il/dashboard?token=synthetic#fragment';
async function trace(event){await fs.appendFile(path.join(app,'fixture-provider-trace.jsonl'),JSON.stringify(event)+'\n')}
const response=value=>({ok:true,status:200,text:async()=>JSON.stringify(value)});
async function fetchFixture(url){
  const parsed=new URL(url);assertOrigin(parsed);
  if(parsed.pathname==='/ServerServices/general/accounts')return response([{bankNumber:12,branchNumber:345,accountNumber:678901,accountClosingReasonCode:0}]);
  if(parsed.pathname.endsWith('/balanceAndCreditLimit'))return response({currentBalance:42,withdrawalBalance:40,creditLimitAmount:100});
  if(parsed.pathname.endsWith('/transactions'))return response({transactions:[]});
  throw new Error('Unexpected synthetic bank endpoint: '+parsed.pathname);
}
function assertOrigin(url){if(url.origin!=='https://login.bankhapoalim.co.il')throw new Error('synthetic provider must never access another origin')}
export const CompanyTypes={hapoalim:'hapoalim'};
export function createScraper(options){
  const page={isClosed:()=>false,url:()=>href,cookies:async()=>[{name:'XSRF-TOKEN',value:'synthetic'}],
    goto:async()=>{},evaluate:async(callback,input)=>vm.runInNewContext('('+callback.toString()+')(input)',{
      input,window:{location:{href,origin:'https://login.bankhapoalim.co.il'},bnhpApp:{restContext:'fixture'}},fetch:fetchFixture
    })};
  return {page,getLoginOptions:()=>({possibleResults:{SUCCESS:[async()=>true]}}),
    initialize:async()=>trace({stage:'initialize',navigationRetryCount:options.navigationRetryCount,showBrowser:options.showBrowser}),
    login:async function(){const login=this.getLoginOptions({});await login.postAction();await trace({stage:'login'});return {success:true}},
    terminate:async success=>{
      await trace({stage:'terminate',success});await fs.writeFile(path.join(app,'fixture-terminate-entered'),'entered');
      while(true){try{await fs.access(path.join(app,'fixture-terminate-release'));break}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(resolve=>setTimeout(resolve,10))}}
      await trace({stage:'terminated'});
    }
  };
}
