import {createHapoalimProvider} from '../../netunim-kupa/bank-bridge/hapoalim-provider.mjs';
import {createCreditProfileSession} from '../../netunim-kupa/bank-bridge/credit-session.mjs';
/** @type {import('../../netunim-kupa/bank-bridge/hapoalim-provider.mjs').BankScraper} */
const scraper={page:{},initialize:async()=>{},login:async()=>({success:true}),terminate:async()=>{}};
/** @type {import('../../netunim-kupa/bank-bridge/hapoalim-provider.mjs').HapoalimProviderPorts} */
const bank={browser:{findInstalled:async()=> 'fixture',ensureProfile:async()=>{},profileDirectory:'fixture',loadScrapers:async()=>({CompanyTypes:{hapoalim:'hapoalim'},createScraper:()=>scraper})},
  session:{decorate:()=>{},reuse:async()=>null,ready:async()=>({ready:true,href:'fixture',restContext:'fixture'}),safeUrl:()=>'',failureMessage:()=>['fixture','FIXTURE']},
  accounts:{lookbackDays:90,read:async()=>({balance:42})},diagnostics:{create:()=>({}),finish:()=>{},write:async()=>{},report:()=>{}},cache:{cleanup:async()=>{}},metadata:{write:async()=>{}},version:73};
const provider=createHapoalimProvider(bank);
provider.read({userCode:'0012',password:' exact secret '},{interactive:true,historyDays:365});
// @ts-expect-error readiness is session evidence, not display text
createHapoalimProvider({...bank,session:{...bank.session,ready:async()=> 'ready'}});
// @ts-expect-error a non-ready probe cannot be published as stable session evidence
createHapoalimProvider({...bank,session:{...bank.session,ready:async()=>({ready:false,href:'fixture',restContext:'fixture'})}});
// @ts-expect-error browser teardown must provide asynchronous completion
createHapoalimProvider({...bank,browser:{...bank.browser,loadScrapers:async()=>({CompanyTypes:{hapoalim:'hapoalim'},createScraper:()=>({...scraper,terminate:()=>true})})}});
// @ts-expect-error account reads must return a snapshot rather than an HTTP status
createHapoalimProvider({...bank,accounts:{...bank.accounts,read:async()=>200}});
// @ts-expect-error diagnostic publication must be joined, not fire-and-forget
createHapoalimProvider({...bank,diagnostics:{...bank.diagnostics,write:()=>{}}});
// @ts-expect-error validated credentials still require the secret string
provider.read({userCode:'0012'});
// @ts-expect-error show-browser flags cannot be arbitrary presentation text
provider.read({userCode:'0012',password:'fixture'},{interactive:'visible'});
/** @type {import('../../netunim-kupa/bank-bridge/credit-session.mjs').CreditSessionPorts} */
const credit={browser:{findInstalled:async()=> 'fixture',loadScrapers:async()=>({CompanyTypes:{},createScraper:()=>{}}),identityProbeUrl:'http://127.0.0.1:8765/health'},
  identity:{directory:()=> 'fixture'},createAdapter:()=>({scrape:async()=>({accounts:[]})}),diagnostics:{record:()=>{}}};
const session=createCreditProfileSession(credit);
session.scrape({profileId:'P',provider:'max',credentials:{password:' secret '}},{excludedAccountNumbers:['0007']});
// @ts-expect-error a connector must return a promised profile result
createCreditProfileSession({...credit,createAdapter:()=>({scrape:async()=> 'done'})});
// @ts-expect-error identity paths are explicit strings
createCreditProfileSession({...credit,identity:{directory:()=>123}});
// @ts-expect-error exclusion lists contain account strings, not numeric IDs
session.scrape({profileId:'P',provider:'max',credentials:{}},{excludedAccountNumbers:[123]});
