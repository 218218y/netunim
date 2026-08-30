import {uid} from '../../core/values.js';
import {wholeMoney} from '../../core/money.js';
import {todayISO} from '../../core/dates.js';
import {bankAutoRefreshDue} from './bridge.js';
import {normalizeBankFeed} from './feed.js';

export function createDomainsBankController({model,session,checksSession,sharedChecksHaveLocalWork,saveState,syncSharedChecksFromCloud,sharedChecksObservedSequence,toast,render,bridge}){
const bridgeState={checked:false,available:null,configured:false,busy:false,upgradeRequired:false,bridgeVersion:0,branchNumber:'',accountNumber:'',availableAccounts:[],lastScrapeAt:null,lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',message:''};
let autoTimer=null;

async function commitBankSnapshot(balance,{source='manual',accountNumber=null,bankSyncAt=undefined,bankFeed=undefined,message='יתרת העו״ש נשמרה כצילום מצב חדש'}={}){
  const numeric=Number(balance);
  if(!Number.isFinite(numeric))throw new Error('התקבלה יתרת בנק לא תקינה');
  if(session.connectionMode==='supabase'){
    if(checksSession.sharedChecksBusy||sharedChecksHaveLocalWork())throw new Error('יש להמתין לסנכרון הצקים לפני צילום יתרת עו״ש חדש');
    const synced=await syncSharedChecksFromCloud({quiet:true,required:true});
    if(!synced||checksSession.sharedChecksBusy||sharedChecksHaveLocalWork())throw new Error('צילום היתרה נעצר: לא ניתן לאמת שהצקים מסונכרנים כרגע. נסה שוב לאחר שהענן מסונכרן.');
  }
  const observedSeq=sharedChecksObservedSequence();
  const previousSyncAt=model.state.bank?.bankSyncAt||null;
  const nextSyncAt=bankSyncAt===undefined?previousSyncAt:(bankSyncAt||null);
  const previousFeed=model.state.bank?.feed||null;
  const nextFeed=bankFeed===undefined?previousFeed:normalizeBankFeed(bankFeed);
  model.state.bank={...model.state.bank,currentBalance:wholeMoney(numeric),updatedAt:new Date().toISOString(),asOfDate:todayISO(),snapshotToken:uid('BANK'),snapshotSeq:observedSeq,adjustments:[],source,sourceAccount:accountNumber||null,bankSyncAt:nextSyncAt,feed:nextFeed};
  return saveState(message);
}

async function saveBankBalance(){
  const el=document.getElementById('bankBalanceInput');
  if(!el||el.value==='')return toast('יש להזין יתרת עו״ש');
  try{await commitBankSnapshot(el.value,{source:'manual'})}catch(e){toast(e.message||String(e))}
}

function bankBridgeUiState(){
  const feed=normalizeBankFeed(model.state.bank?.feed);
  const sharedLastSyncAt=feed?.syncedAt||model.state.bank?.bankSyncAt||(model.state.bank?.source==='hapoalim'?model.state.bank?.updatedAt:null)||null;
  return {...bridgeState,tokenConfigured:!!bridge.getBridgeToken(),autoEnabled:bridge.autoEnabled(),sharedLastSyncAt,feed};
}

async function refreshBankBridgeStatus(){
  if(!bridge.getBridgeToken()){
    Object.assign(bridgeState,{checked:true,available:null,configured:false,branchNumber:'',accountNumber:'',availableAccounts:[],lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',message:'יש להזין מפתח Bridge כדי לחבר את הקופה לתוכנה המקומית.'});
    return bankBridgeUiState();
  }
  try{
    const s=await bridge.status(),bridgeVersion=Number(s.bridgeVersion||0),upgradeRequired=bridgeVersion<8;
    if(upgradeRequired){
      Object.assign(bridgeState,{checked:true,available:true,configured:!!s.configured,upgradeRequired:true,bridgeVersion,branchNumber:s.branchNumber||'',accountNumber:s.accountNumber||'',availableAccounts:Array.isArray(s.availableAccounts)?s.availableAccounts:[],lastScrapeAt:s.lastScrapeAt||null,lastError:s.lastError||'',lastErrorCode:s.lastErrorCode||'',lastErrorStage:s.lastErrorStage||'',lastErrorHttpStatus:Number(s.lastErrorHttpStatus)||0,lastWarning:s.lastWarning||'',message:'מותקנת במחשב גרסת Bank Bridge ישנה. יש להריץ מחדש install_bank_bridge.bat כדי לקבל קריאה יציבה גם בזמן ניווטים של אתר הפועלים.'});
    }else{
      Object.assign(bridgeState,{checked:true,available:true,configured:!!s.configured,upgradeRequired:false,bridgeVersion,branchNumber:s.branchNumber||'',accountNumber:s.accountNumber||'',availableAccounts:Array.isArray(s.availableAccounts)?s.availableAccounts:[],lastScrapeAt:s.lastScrapeAt||null,lastError:s.lastError||'',lastErrorCode:s.lastErrorCode||'',lastErrorStage:s.lastErrorStage||'',lastErrorHttpStatus:Number(s.lastErrorHttpStatus)||0,lastWarning:s.lastWarning||'',message:s.configured?'החיבור המקומי מוכן.':'Bank Bridge פעיל, אך עדיין לא נשמרו בו פרטי בנק הפועלים.'});
    }
  }catch(e){Object.assign(bridgeState,{checked:true,available:false,configured:false,upgradeRequired:false,bridgeVersion:0,availableAccounts:Array.isArray(e.availableAccounts)?e.availableAccounts:[],lastError:e.message||String(e),lastErrorCode:e.code||'',lastErrorStage:e.stage||'',lastErrorHttpStatus:Number(e.httpStatus)||0,lastWarning:'',message:e.message||String(e)})}
  return bankBridgeUiState();
}

async function saveBankBridgeToken(){
  const token=document.getElementById('bankBridgeTokenInput')?.value?.trim()||'';
  if(!token)return toast('יש להדביק את מפתח ה-Bridge של המחשב הנוכחי');
  bridge.setBridgeToken(token);
  const input=document.getElementById('bankBridgeTokenInput');if(input)input.value='';
  Object.assign(bridgeState,{checked:false,available:null,availableAccounts:[],lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,message:'מפתח המחשב נשמר בדפדפן זה. בודק את ה-Bridge…'});
  render();
  await refreshBankBridgeStatus();render();
  if(bridgeState.available)toast('מפתח ה-Bridge נשמר והמחשב מחובר');
}

async function configureBankBridge(){
  const typedToken=document.getElementById('bankBridgeTokenInput')?.value?.trim()||'';
  if(typedToken)bridge.setBridgeToken(typedToken);
  const token=bridge.getBridgeToken();
  const userCode=document.getElementById('bankUserCodeInput')?.value?.trim()||'';
  const password=document.getElementById('bankPasswordInput')?.value||'';
  const branchNumber=document.getElementById('bankBranchNumberInput')?.value?.trim()||'';
  const accountNumber=document.getElementById('bankAccountNumberInput')?.value?.trim()||'';
  if(!token)return toast('יש לשמור קודם את מפתח ה-Bridge של המחשב הנוכחי');
  if(!userCode||!password)return toast('יש להזין קוד משתמש וסיסמה של בנק הפועלים');
  if((branchNumber&&!accountNumber)||(!branchNumber&&accountNumber))return toast('לבחירת חשבון יש להזין גם סניף וגם מספר חשבון');
  bridgeState.busy=true;render();
  try{
    const r=await bridge.configureCredentials({token,userCode,password,branchNumber,accountNumber});
    Object.assign(bridgeState,{available:true,configured:true,branchNumber:r.branchNumber||branchNumber,accountNumber:r.accountNumber||accountNumber,availableAccounts:[],lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',message:'פרטי ההתחברות נשמרו מוצפנים במחשב המקומי.'});
    toast('החיבור לבנק הפועלים נשמר במחשב. אפשר לרענן את היתרה כעת.');
  }catch(e){bridgeState.lastError=e.message||String(e);bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:[];toast(bridgeState.lastError)}
  finally{bridgeState.busy=false;render()}
}

async function selectBankBridgeAccount(branchNumber,accountNumber){
  const branch=String(branchNumber||'').replace(/\D/g,''),account=String(accountNumber||'').replace(/\D/g,'');
  if(!branch||!account)return toast('לא התקבל סניף/חשבון תקין לבחירה');
  if(bridgeState.busy)return false;
  bridgeState.busy=true;render();
  try{
    const r=await bridge.selectAccount({branchNumber:branch,accountNumber:account});
    Object.assign(bridgeState,{configured:true,branchNumber:r.branchNumber||branch,accountNumber:r.accountNumber||account,availableAccounts:[],lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,message:`נבחר סניף ${r.branchNumber||branch}, חשבון ${r.accountNumber||account}. אפשר לרענן כעת.`});
    toast(`נבחר חשבון ${r.branchNumber||branch}-${r.accountNumber||account}`);
    return true;
  }catch(e){
    bridgeState.lastError=e.message||String(e);bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:bridgeState.availableAccounts;toast(bridgeState.lastError);return false;
  }finally{bridgeState.busy=false;render()}
}

async function deleteBankBridgeCredentials(){
  bridgeState.busy=true;render();
  try{await bridge.deleteCredentials();Object.assign(bridgeState,{configured:false,branchNumber:'',accountNumber:'',availableAccounts:[],lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',message:'פרטי ההתחברות נמחקו מהמחשב המקומי.'});toast('פרטי בנק הפועלים נמחקו מה-Bank Bridge')}
  catch(e){bridgeState.lastError=e.message||String(e);bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';toast(bridgeState.lastError)}
  finally{bridgeState.busy=false;render()}
}

function setBankAutoRefresh(enabled){bridge.setAutoEnabled(!!enabled);toast(enabled?'עדכון יומי אוטומטי הופעל':'עדכון יומי אוטומטי כובה');maybeAutoRefreshBankBalance()}

async function refreshBankBalance({interactive=false,auto=false}={}){
  if(bridgeState.busy)return false;
  if(!bridge.getBridgeToken()){if(!auto)toast('החיבור לבנק עדיין לא הוגדר');return false}
  if(bridgeState.upgradeRequired){if(!auto)toast('יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני עדכון מול הבנק');return false}
  bridgeState.busy=true;bridgeState.lastError='';bridgeState.lastErrorCode='';bridgeState.lastErrorStage='';bridgeState.lastErrorHttpStatus=0;bridgeState.lastWarning='';
  bridgeState.message=interactive?'חלון האימות בבנק פתוח. לאחר האימות ה-Bridge ימתין גם לטעינת שירותי הנתונים לפני קריאת היתרה.':auto?'מעדכן יתרה ותנועות אוטומטית מבנק הפועלים…':'מעדכן יתרה ותנועות מבנק הפועלים…';
  if(auto)bridge.markAutoAttempt();render();
  try{
    const result=await bridge.fetchBalance({interactive});
    if(!Number.isFinite(Number(result.balance)))throw new Error('Bank Bridge לא החזיר יתרה תקינה');
    const fetchedAt=result.fetchedAt||new Date().toISOString();
    const canonicalAccount=result.accountId||[result.branchNumber,result.accountNumber].filter(Boolean).join('-')||result.accountNumber||'';
    const feed=normalizeBankFeed({provider:'hapoalim',accountNumber:canonicalAccount,balance:Number(result.balance),syncedAt:fetchedAt,transactions:result.transactions||[],transactionWarning:result.transactionWarning||''});
    await commitBankSnapshot(result.balance,{source:'hapoalim',accountNumber:canonicalAccount||null,bankSyncAt:fetchedAt,bankFeed:feed,message:auto?'נתוני הבנק עודכנו אוטומטית מבנק הפועלים':'יתרת העו״ש ונתוני הבנק עודכנו מבנק הפועלים'});
    Object.assign(bridgeState,{available:true,configured:true,upgradeRequired:false,bridgeVersion:Math.max(8,bridgeState.bridgeVersion||0),branchNumber:result.branchNumber||bridgeState.branchNumber,accountNumber:result.accountNumber||bridgeState.accountNumber,availableAccounts:[],lastScrapeAt:fetchedAt,lastError:'',lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:result.transactionWarning||'',message:result.transactionWarning?'היתרה עודכנה בהצלחה; קיימת אזהרה לגבי התנועות האחרונות.':'היתרה והתנועות האחרונות התקבלו בהצלחה מבנק הפועלים.'});
    if(result.transactionWarning&&!auto)toast('היתרה עודכנה. התנועות האחרונות לא נטענו במלואן; פרטי האזהרה מוצגים במסך הבנק.');
    return true;
  }catch(e){
    bridgeState.lastError=e.message||String(e);bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:[];bridgeState.message=bridgeState.lastError;
    if(!auto)toast(bridgeState.lastError);
    return false;
  }finally{bridgeState.busy=false;render()}
}

function maybeAutoRefreshBankBalance(){
  if(autoTimer){clearTimeout(autoTimer);autoTimer=null}
  if(!session.backendReady||!bridge.autoEnabled()||!bridge.getBridgeToken()||bridgeState.busy)return;
  const feed=normalizeBankFeed(model.state.bank?.feed),now=Date.now(),lastSyncAt=feed?.syncedAt||model.state.bank?.bankSyncAt||(model.state.bank?.source==='hapoalim'?model.state.bank?.updatedAt:null),lastSyncMs=lastSyncAt?Date.parse(lastSyncAt):NaN;
  if(!bankAutoRefreshDue(lastSyncAt,now)){
    const dueIn=Math.max(1000,lastSyncMs+24*60*60*1000-now+250);autoTimer=setTimeout(maybeAutoRefreshBankBalance,dueIn);return;
  }
  const retryIn=bridge.autoAttemptDelayMs(now);
  if(retryIn>0){autoTimer=setTimeout(maybeAutoRefreshBankBalance,Math.max(1000,retryIn+250));return}
  autoTimer=setTimeout(()=>{autoTimer=null;refreshBankBalance({interactive:false,auto:true}).catch(e=>console.error('bank auto refresh',e))},300);
}

return {saveBankBalance,bankBridgeUiState,refreshBankBridgeStatus,saveBankBridgeToken,configureBankBridge,selectBankBridgeAccount,deleteBankBridgeCredentials,setBankAutoRefresh,refreshBankBalance,maybeAutoRefreshBankBalance,commitBankSnapshot};
}
