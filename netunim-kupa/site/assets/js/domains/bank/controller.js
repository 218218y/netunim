import {uid} from '../../core/values.js';
import {wholeMoney} from '../../core/money.js';
import {todayISO} from '../../core/dates.js';
import {bankAutoRefreshDue} from './bridge.js';
import {normalizeBankFeed} from './feed.js';

const BANK_BRIDGE_VERSION=21;

export function createDomainsBankController({model,session,checksSession,sharedChecksHaveLocalWork,saveState,syncSharedChecksFromCloud,sharedChecksObservedSequence,toast,render,bridge,refreshFinanceCloudSnapshot=async()=>({verified:true,state:model.state})}){
const bridgeState={checked:false,available:null,configured:false,busy:false,upgradeRequired:false,bridgeVersion:0,branchNumber:'',accountNumber:'',businessBranchNumber:'',businessAccountNumber:'',homeBranchNumber:'',homeAccountNumber:'',availableAccounts:[],accountSelectionRole:'',lastScrapeAt:null,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,message:''};
let autoTimer=null;

function accountIdOf(snapshot){return snapshot?.accountId||[snapshot?.branchNumber,snapshot?.accountNumber].filter(Boolean).join('-')||snapshot?.accountNumber||''}
function sharedBankLastSyncAt(state=model.state){const feed=normalizeBankFeed(state?.bank?.feed);return feed?.syncedAt||state?.bank?.bankSyncAt||(state?.bank?.source==='hapoalim'?state?.bank?.updatedAt:null)||null}
function feedFromSnapshot(snapshot,fetchedAt){
  if(!snapshot||!Number.isFinite(Number(snapshot.balance)))return null;
  return normalizeBankFeed({provider:'hapoalim',accountNumber:accountIdOf(snapshot),balance:Number(snapshot.balance),syncedAt:fetchedAt,transactions:snapshot.transactions||[],transactionWarning:snapshot.transactionWarning||''});
}
function applyBridgeAccountFields(target,source={}){
  const businessBranchNumber=source.businessBranchNumber||source.branchNumber||target.businessBranchNumber||target.branchNumber||'';
  const businessAccountNumber=source.businessAccountNumber||source.accountNumber||target.businessAccountNumber||target.accountNumber||'';
  Object.assign(target,{branchNumber:businessBranchNumber,accountNumber:businessAccountNumber,businessBranchNumber,businessAccountNumber,homeBranchNumber:source.homeBranchNumber??target.homeBranchNumber??'',homeAccountNumber:source.homeAccountNumber??target.homeAccountNumber??''});
}

async function commitBankSnapshot(balance,{source='manual',accountNumber=null,bankSyncAt=undefined,bankFeed=undefined,homeBankFeed=undefined,message='יתרת העו״ש נשמרה כצילום מצב חדש'}={}){
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
  const previousHomeFeed=model.state.bank?.homeFeed||null;
  const nextHomeFeed=homeBankFeed===undefined?previousHomeFeed:normalizeBankFeed(homeBankFeed);
  model.state.bank={...model.state.bank,currentBalance:wholeMoney(numeric),updatedAt:new Date().toISOString(),asOfDate:todayISO(),snapshotToken:uid('BANK'),snapshotSeq:observedSeq,adjustments:[],source,sourceAccount:accountNumber||null,bankSyncAt:nextSyncAt,feed:nextFeed,homeFeed:nextHomeFeed};
  return saveState(message);
}

async function saveBankBalance(){
  const el=document.getElementById('bankBalanceInput');
  if(!el||el.value==='')return toast('יש להזין יתרת עו״ש');
  try{await commitBankSnapshot(el.value,{source:'manual'})}catch(e){toast(e.message||String(e))}
}

function bankBridgeUiState(){
  const feed=normalizeBankFeed(model.state.bank?.feed),homeFeed=normalizeBankFeed(model.state.bank?.homeFeed);
  const sharedLastSyncAt=sharedBankLastSyncAt();
  const homeLastSyncAt=homeFeed?.syncedAt||null;
  return {...bridgeState,tokenConfigured:!!bridge.getBridgeToken(),autoEnabled:bridge.autoEnabled(),sharedLastSyncAt,homeLastSyncAt,feed,homeFeed};
}

async function refreshBankBridgeStatus(){
  if(!bridge.getBridgeToken()){
    Object.assign(bridgeState,{checked:true,available:null,configured:false,branchNumber:'',accountNumber:'',businessBranchNumber:'',businessAccountNumber:'',homeBranchNumber:'',homeAccountNumber:'',availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,message:'יש להזין מפתח Bridge כדי לחבר את הקופה לתוכנה המקומית.'});
    return bankBridgeUiState();
  }
  try{
    const s=await bridge.status(),bridgeVersion=Number(s.bridgeVersion||0),upgradeRequired=bridgeVersion<BANK_BRIDGE_VERSION;
    const common={checked:true,available:true,configured:!!s.configured,upgradeRequired,bridgeVersion,availableAccounts:Array.isArray(s.availableAccounts)?s.availableAccounts:[],accountSelectionRole:s.accountRole||'',lastScrapeAt:s.lastScrapeAt||null,lastError:s.lastError||'',lastErrorAt:s.lastErrorAt||null,lastErrorCode:s.lastErrorCode||'',lastErrorStage:s.lastErrorStage||'',lastErrorHttpStatus:Number(s.lastErrorHttpStatus)||0,lastWarning:s.lastWarning||'',lastWarningCode:s.lastWarningCode||'',lastWarningStage:s.lastWarningStage||'',lastWarningHttpStatus:Number(s.lastWarningHttpStatus)||0};
    Object.assign(bridgeState,common);applyBridgeAccountFields(bridgeState,s);
    bridgeState.message=upgradeRequired?'מותקנת במחשב גרסת Bank Bridge ישנה. יש להריץ מחדש install_bank_bridge.bat כדי להפעיל סנכרון בטוח של החשבון העסקי והביתי יחד.':s.configured?'החיבור המקומי מוכן.':'Bank Bridge פעיל, אך עדיין לא נשמרו בו פרטי בנק הפועלים.';
  }catch(e){Object.assign(bridgeState,{checked:true,available:false,configured:false,upgradeRequired:false,bridgeVersion:0,availableAccounts:Array.isArray(e.availableAccounts)?e.availableAccounts:[],accountSelectionRole:e.accountRole||'',lastError:e.message||String(e),lastErrorAt:new Date().toISOString(),lastErrorCode:e.code||'',lastErrorStage:e.stage||'',lastErrorHttpStatus:Number(e.httpStatus)||0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,message:e.message||String(e)})}
  return bankBridgeUiState();
}

async function saveBankBridgeToken(){
  const token=document.getElementById('bankBridgeTokenInput')?.value?.trim()||'';
  if(!token)return toast('יש להדביק את מפתח ה-Bridge של המחשב הנוכחי');
  bridge.setBridgeToken(token);
  const input=document.getElementById('bankBridgeTokenInput');if(input)input.value='';
  Object.assign(bridgeState,{checked:false,available:null,availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,message:'מפתח המחשב נשמר בדפדפן זה. בודק את ה-Bridge…'});
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
  const businessBranchNumber=document.getElementById('bankBusinessBranchNumberInput')?.value?.trim()||'';
  const businessAccountNumber=document.getElementById('bankBusinessAccountNumberInput')?.value?.trim()||'';
  const homeBranchNumber=document.getElementById('bankHomeBranchNumberInput')?.value?.trim()||'';
  const homeAccountNumber=document.getElementById('bankHomeAccountNumberInput')?.value?.trim()||'';
  if(!token)return toast('יש לשמור קודם את מפתח ה-Bridge של המחשב הנוכחי');
  if(!userCode||!password)return toast('יש להזין קוד משתמש וסיסמה של בנק הפועלים');
  if((businessBranchNumber&&!businessAccountNumber)||(!businessBranchNumber&&businessAccountNumber))return toast('לחשבון העסקי יש להזין גם סניף וגם מספר חשבון');
  if((homeBranchNumber&&!homeAccountNumber)||(!homeBranchNumber&&homeAccountNumber))return toast('לחשבון הביתי יש להזין גם סניף וגם מספר חשבון');
  if(businessBranchNumber&&homeBranchNumber&&businessBranchNumber.replace(/\D/g,'')===homeBranchNumber.replace(/\D/g,'')&&businessAccountNumber.replace(/\D/g,'')===homeAccountNumber.replace(/\D/g,''))return toast('החשבון העסקי והחשבון הביתי חייבים להיות שני חשבונות שונים');
  bridgeState.busy=true;render();
  try{
    const r=await bridge.configureCredentials({token,userCode,password,businessBranchNumber,businessAccountNumber,homeBranchNumber,homeAccountNumber});
    Object.assign(bridgeState,{available:true,configured:true,upgradeRequired:false,bridgeVersion:Math.max(BANK_BRIDGE_VERSION,bridgeState.bridgeVersion||0),availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,message:'פרטי ההתחברות ושני החשבונות נשמרו מוצפנים במחשב המקומי.'});applyBridgeAccountFields(bridgeState,r);
    toast(homeAccountNumber?'החיבור לבנק הפועלים נשמר. רענון יעדכן יחד את החשבון העסקי והביתי.':'החיבור לבנק הפועלים נשמר. אפשר להוסיף גם את החשבון הביתי בהגדרות.');
  }catch(e){bridgeState.lastError=e.message||String(e);bridgeState.lastErrorAt=new Date().toISOString();bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:[];bridgeState.accountSelectionRole=e.accountRole||'';toast(bridgeState.lastError)}
  finally{bridgeState.busy=false;render()}
}

async function selectBankBridgeAccount(role,branchNumber,accountNumber){
  const targetRole=role==='home'?'home':'business',branch=String(branchNumber||'').replace(/\D/g,''),account=String(accountNumber||'').replace(/\D/g,'');
  if(!branch||!account)return toast('לא התקבל סניף/חשבון תקין לבחירה');
  if(bridgeState.busy)return false;
  bridgeState.busy=true;render();
  try{
    const r=await bridge.selectAccount({role:targetRole,branchNumber:branch,accountNumber:account});
    Object.assign(bridgeState,{configured:true,availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,message:`נבחר חשבון ${targetRole==='home'?'ביתי':'עסקי'}: סניף ${branch}, חשבון ${account}. אפשר לרענן כעת.`});applyBridgeAccountFields(bridgeState,r);
    toast(`נבחר חשבון ${targetRole==='home'?'ביתי':'עסקי'} ${branch}-${account}`);
    return true;
  }catch(e){
    bridgeState.lastError=e.message||String(e);bridgeState.lastErrorAt=new Date().toISOString();bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:bridgeState.availableAccounts;bridgeState.accountSelectionRole=e.accountRole||targetRole;toast(bridgeState.lastError);return false;
  }finally{bridgeState.busy=false;render()}
}

async function deleteBankBridgeCredentials(){
  bridgeState.busy=true;render();
  try{await bridge.deleteCredentials();Object.assign(bridgeState,{configured:false,branchNumber:'',accountNumber:'',businessBranchNumber:'',businessAccountNumber:'',homeBranchNumber:'',homeAccountNumber:'',availableAccounts:[],accountSelectionRole:'',lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:'',lastWarningCode:'',lastWarningStage:'',lastWarningHttpStatus:0,message:'פרטי ההתחברות נמחקו מהמחשב המקומי.'});toast('פרטי בנק הפועלים נמחקו מה-Bank Bridge')}
  catch(e){bridgeState.lastError=e.message||String(e);bridgeState.lastErrorAt=new Date().toISOString();bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';toast(bridgeState.lastError)}
  finally{bridgeState.busy=false;render()}
}

function setBankAutoRefresh(enabled){bridge.setAutoEnabled(!!enabled);toast(enabled?'עדכון יומי אוטומטי הופעל':'עדכון יומי אוטומטי כובה');maybeAutoRefreshBankBalance()}

async function refreshBankBalance({interactive=false,auto=false}={}){
  if(bridgeState.busy)return false;
  if(!bridge.getBridgeToken()){if(!auto)toast('החיבור לבנק עדיין לא הוגדר');return false}
  if(bridgeState.upgradeRequired){if(!auto)toast('יש להריץ מחדש install_bank_bridge.bat במחשב זה לפני עדכון מול הבנק');return false}
  bridgeState.busy=true;bridgeState.lastError='';bridgeState.lastErrorAt=null;bridgeState.lastErrorCode='';bridgeState.lastErrorStage='';bridgeState.lastErrorHttpStatus=0;bridgeState.lastWarning='';bridgeState.lastWarningCode='';bridgeState.lastWarningStage='';bridgeState.lastWarningHttpStatus=0;bridgeState.accountSelectionRole='';
  bridgeState.message=interactive?'חלון האימות בבנק פתוח. לאחר האימות ה-Bridge יעדכן באותו סשן את החשבון העסקי ואת החשבון הביתי.':auto?'מעדכן אוטומטית את שני חשבונות בנק הפועלים…':'מעדכן יתרות ותנועות בשני חשבונות בנק הפועלים…';
  render();
  try{
    if(auto){
      const latest=await refreshFinanceCloudSnapshot();
      if(!latest?.verified){bridge.markAutoAttempt();throw new Error('לא ניתן לאמת את זמן סנכרון הבנק המשותף בענן');}
      if(!bankAutoRefreshDue(sharedBankLastSyncAt(latest.state||model.state))){bridge.markAutoAttempt();return true}
      bridge.markAutoAttempt();
    }
    const result=await bridge.fetchBalance({interactive}),business=result.accounts?.business||result,home=result.accounts?.home??null,homeFailure=result.accountFailures?.home||null;
    if(!Number.isFinite(Number(business?.balance)))throw new Error('Bank Bridge לא החזיר יתרה עסקית תקינה');
    if(home&&!Number.isFinite(Number(home.balance)))throw new Error('Bank Bridge לא החזיר יתרה ביתית תקינה');
    const fetchedAt=result.fetchedAt||new Date().toISOString();
    const businessFeed=feedFromSnapshot(business,fetchedAt),homeFeed=home?feedFromSnapshot(home,fetchedAt):null;
    const businessAccount=accountIdOf(business),warnings=[business?.transactionWarning?`עסקי: ${business.transactionWarning}`:'',home?.transactionWarning?`ביתי: ${home.transactionWarning}`:'',homeFailure?.message?`ביתי: ${homeFailure.message}`:''].filter(Boolean);
    const nextHomeFeed=home?homeFeed:(homeFailure?undefined:null);
    await commitBankSnapshot(business.balance,{source:'hapoalim',accountNumber:businessAccount||null,bankSyncAt:fetchedAt,bankFeed:businessFeed,homeBankFeed:nextHomeFeed,message:auto?(homeFailure?'החשבון העסקי עודכן אוטומטית; החשבון הביתי נשאר בנתון האחרון בגלל תקלה נקודתית.':'שני חשבונות הבנק עודכנו אוטומטית מבנק הפועלים'):homeFailure?'החשבון העסקי עודכן; החשבון הביתי נשאר בנתון האחרון עד לתיקון החיבור.':home?'החשבון העסקי והחשבון הביתי עודכנו מבנק הפועלים':'יתרת העו״ש ונתוני החשבון העסקי עודכנו מבנק הפועלים'});
    Object.assign(bridgeState,{available:true,configured:true,upgradeRequired:false,bridgeVersion:Math.max(BANK_BRIDGE_VERSION,bridgeState.bridgeVersion||0),availableAccounts:Array.isArray(homeFailure?.availableAccounts)?homeFailure.availableAccounts:[],accountSelectionRole:homeFailure?'home':'',lastScrapeAt:fetchedAt,lastError:'',lastErrorAt:null,lastErrorCode:'',lastErrorStage:'',lastErrorHttpStatus:0,lastWarning:warnings.join(' | '),lastWarningCode:homeFailure?.code||'',lastWarningStage:homeFailure?.stage||'',lastWarningHttpStatus:Number(homeFailure?.httpStatus)||0,message:homeFailure?'החשבון העסקי עודכן בהצלחה; החשבון הביתי לא עודכן ונשמר הנתון הביתי האחרון.':warnings.length?'היתרות עודכנו בהצלחה; קיימת אזהרה לגבי חלק מהתנועות.':home?'שני החשבונות והפעילות האחרונה התקבלו בהצלחה מבנק הפועלים.':'החשבון העסקי והתנועות האחרונות התקבלו בהצלחה מבנק הפועלים.'});
    applyBridgeAccountFields(bridgeState,{businessBranchNumber:business.branchNumber,businessAccountNumber:business.accountNumber,homeBranchNumber:home?.branchNumber??bridgeState.homeBranchNumber,homeAccountNumber:home?.accountNumber??bridgeState.homeAccountNumber});
    if(homeFailure&&!auto)toast('החשבון העסקי עודכן. החשבון הביתי לא עודכן; הנתון הביתי הקודם נשמר ופרטי התקלה מוצגים במסך הבנק.');
    else if(warnings.length&&!auto)toast('היתרות עודכנו. חלק מהתנועות לא נטענו במלואן; פרטי האזהרה מוצגים במסך הבנק.');
    return true;
  }catch(e){
    bridgeState.lastError=e.message||String(e);bridgeState.lastErrorAt=new Date().toISOString();bridgeState.lastErrorCode=e.code||'';bridgeState.lastErrorStage=e.stage||'';bridgeState.lastErrorHttpStatus=Number(e.httpStatus)||0;bridgeState.availableAccounts=Array.isArray(e.availableAccounts)?e.availableAccounts:[];bridgeState.accountSelectionRole=e.accountRole||'';bridgeState.message=bridgeState.lastError;
    if(!auto)toast(bridgeState.lastError);
    return false;
  }finally{bridgeState.busy=false;render()}
}

function maybeAutoRefreshBankBalance(){
  if(autoTimer){clearTimeout(autoTimer);autoTimer=null}
  if(!session.backendReady||!bridge.autoEnabled()||!bridge.getBridgeToken()||bridgeState.busy)return;
  const now=Date.now(),lastSyncAt=sharedBankLastSyncAt(),lastSyncMs=lastSyncAt?Date.parse(lastSyncAt):NaN;
  if(!bankAutoRefreshDue(lastSyncAt,now)){
    const dueIn=Math.max(1000,lastSyncMs+24*60*60*1000-now+250);autoTimer=setTimeout(maybeAutoRefreshBankBalance,dueIn);return;
  }
  const retryIn=bridge.autoAttemptDelayMs(now);
  if(retryIn>0){autoTimer=setTimeout(maybeAutoRefreshBankBalance,Math.max(1000,retryIn+250));return}
  autoTimer=setTimeout(()=>{autoTimer=null;refreshBankBalance({interactive:false,auto:true}).catch(e=>console.error('bank auto refresh',e))},300);
}

return {saveBankBalance,bankBridgeUiState,refreshBankBridgeStatus,saveBankBridgeToken,configureBankBridge,selectBankBridgeAccount,deleteBankBridgeCredentials,setBankAutoRefresh,refreshBankBalance,maybeAutoRefreshBankBalance,commitBankSnapshot};
}
