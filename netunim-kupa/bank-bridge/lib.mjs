export const INTERACTIVE_AUTH_TIMEOUT_MS=10*60*1000;
export const SILENT_AUTH_TIMEOUT_MS=90*1000;
export const HAPOALIM_POST_LOGIN_TIMEOUT_MS=60*1000;
export const HAPOALIM_NAVIGATION_STABLE_MS=1500;
export const HAPOALIM_DATA_RETRY_LIMIT=3;
export const HAPOALIM_TRANSACTION_LOOKBACK_DAYS=30;
export const HAPOALIM_TRANSACTION_LIMIT=1000;

function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms))}

export function isTransientNavigationError(error){
  const message=String(error?.message||error||'').toLowerCase();
  return message.includes('execution context was destroyed')
    || message.includes('cannot find context with specified id')
    || message.includes('inspected target navigated or closed')
    || message.includes('most likely because of a navigation')
    || message.includes('protocol error (runtime.callfunctionon)');
}

export async function retryTransientNavigation(operation,{attempts=HAPOALIM_DATA_RETRY_LIMIT,onRetry=async()=>{}}={}){
  const count=Math.max(1,Number(attempts)||HAPOALIM_DATA_RETRY_LIMIT);
  let lastError;
  for(let attempt=1;attempt<=count;attempt++){
    try{return await operation(attempt)}
    catch(error){
      lastError=error;
      if(attempt>=count||!isTransientNavigationError(error))throw error;
      await onRetry(error,attempt);
    }
  }
  throw lastError;
}

async function currentPageUrl(page){
  try{return String(await page.evaluate(()=>window.location.href))}
  catch{return String(page?.url?.()||'')}
}

async function loginConditionMatches(condition,page,value){
  if(condition instanceof RegExp){condition.lastIndex=0;return condition.test(value)}
  if(typeof condition==='function')return !!(await condition({page,value}));
  return String(value).toLowerCase()===String(condition).toLowerCase();
}

export async function waitForTerminalLoginResult(page,possibleResults,{timeoutMs=INTERACTIVE_AUTH_TIMEOUT_MS,pollMs=500,timeoutCode='INTERACTIVE_AUTH_TIMEOUT',timeoutMarker='NETUNIM_INTERACTIVE_AUTH_TIMEOUT',closedCode='INTERACTIVE_BROWSER_CLOSED',closedMarker='NETUNIM_INTERACTIVE_BROWSER_CLOSED'}={}){
  const deadline=Date.now()+Math.max(1,Number(timeoutMs)||INTERACTIVE_AUTH_TIMEOUT_MS);
  while(Date.now()<deadline){
    if(page?.isClosed?.()){const e=new Error(closedMarker);e.code=closedCode;throw e}
    const value=await currentPageUrl(page);
    for(const [resultKey,conditions] of Object.entries(possibleResults||{})){
      for(const condition of Array.isArray(conditions)?conditions:[conditions]){
        try{if(await loginConditionMatches(condition,page,value))return {resultKey,value}}catch{}
      }
    }
    await sleep(Math.min(Math.max(10,pollMs),Math.max(10,deadline-Date.now())));
  }
  const e=new Error(timeoutMarker);e.code=timeoutCode;throw e;
}

export function normalizeAccountNumber(value){return String(value||'').replace(/\D/g,'')}
export function normalizeAccountPart(value){return String(value??'').trim().replace(/\D/g,'')}

export function accountDescriptor(account){
  const bankNumber=normalizeAccountPart(account?.bankNumber);
  const branchNumber=normalizeAccountPart(account?.branchNumber);
  const accountNumber=normalizeAccountPart(account?.accountNumber);
  const accountId=[bankNumber,branchNumber,accountNumber].filter(Boolean).join('-');
  return {...account,bankNumber,branchNumber,accountNumber,accountId};
}

export function publicAccountDescriptors(accounts){
  return (Array.isArray(accounts)?accounts:[]).map(accountDescriptor).filter(x=>x.branchNumber&&x.accountNumber).map(x=>({
    bankNumber:x.bankNumber||'12',branchNumber:x.branchNumber,accountNumber:x.accountNumber,accountId:x.accountId||['12',x.branchNumber,x.accountNumber].join('-')
  }));
}

export function parseAccountSelector(target=''){
  if(target&&typeof target==='object'){
    return {
      bankNumber:normalizeAccountPart(target.bankNumber)||'12',
      branchNumber:normalizeAccountPart(target.branchNumber),
      accountNumber:normalizeAccountPart(target.accountNumber),
    };
  }
  const raw=String(target||'').trim();
  if(!raw)return {bankNumber:'12',branchNumber:'',accountNumber:''};
  const parts=raw.split(/[^0-9]+/).map(normalizeAccountPart).filter(Boolean);
  if(parts.length>=3)return {bankNumber:parts.at(-3),branchNumber:parts.at(-2),accountNumber:parts.at(-1)};
  if(parts.length===2)return {bankNumber:'12',branchNumber:parts[0],accountNumber:parts[1]};
  return {bankNumber:'12',branchNumber:'',accountNumber:normalizeAccountPart(raw)};
}

function accountSelectionError(code,message,accounts){
  const e=new Error(message);e.code=code;e.availableAccounts=publicAccountDescriptors(accounts);return e;
}

function descriptorMatchesSelector(descriptor,selector){
  if(!selector.accountNumber)return false;
  if(descriptor.accountNumber!==selector.accountNumber)return false;
  if(selector.branchNumber&&descriptor.branchNumber!==selector.branchNumber)return false;
  if(selector.bankNumber&&selector.branchNumber&&descriptor.bankNumber&&descriptor.bankNumber!==selector.bankNumber)return false;
  return true;
}

export function selectBalanceAccount(accounts,targetAccount=''){
  const withBalance=(Array.isArray(accounts)?accounts:[]).filter(x=>Number.isFinite(Number(x?.balance)));
  if(!withBalance.length){const e=new Error('לא התקבלה יתרה מאף חשבון פעיל בבנק הפועלים');e.code='NO_BALANCE';throw e}
  const selector=parseAccountSelector(targetAccount);
  if(selector.accountNumber){
    const normalized=withBalance.map(x=>{
      const parsed=parseAccountSelector(x?.accountNumber||'');
      return {source:x,bankNumber:parsed.bankNumber,branchNumber:parsed.branchNumber,accountNumber:parsed.accountNumber,accountId:String(x?.accountNumber||'')};
    });
    const matches=normalized.filter(x=>descriptorMatchesSelector(x,selector));
    if(matches.length===1)return matches[0].source;
    if(matches.length>1)throw accountSelectionError('AMBIGUOUS_ACCOUNT','מספר החשבון מתאים ליותר מחשבון אחד. יש לבחור גם את הסניף המדויק.',normalized);
    throw accountSelectionError('ACCOUNT_NOT_FOUND','החשבון שהוגדר לא נמצא בין החשבונות הפעילים של המשתמש',normalized);
  }
  if(withBalance.length===1)return withBalance[0];
  throw accountSelectionError('MULTIPLE_ACCOUNTS','נמצאו כמה חשבונות בבנק הפועלים. יש לבחור סניף ומספר חשבון מדויקים.',withBalance);
}

export function selectAccountDescriptor(accounts,targetAccount=''){
  const normalized=(Array.isArray(accounts)?accounts:[]).map(accountDescriptor).filter(x=>x.branchNumber&&x.accountNumber);
  if(!normalized.length){const e=new Error('בנק הפועלים לא החזיר חשבונות עו״ש פעילים');e.code='NO_ACCOUNTS';throw e}
  const selector=parseAccountSelector(targetAccount);
  if(selector.accountNumber){
    const matches=normalized.filter(x=>descriptorMatchesSelector(x,selector));
    if(matches.length===1)return matches[0];
    if(matches.length>1)throw accountSelectionError('AMBIGUOUS_ACCOUNT','מספר החשבון מתאים ליותר מחשבון אחד. יש לבחור גם את הסניף המדויק.',normalized);
    throw accountSelectionError('ACCOUNT_NOT_FOUND','החשבון שהוגדר לא נמצא בין החשבונות הפעילים שהחזיר בנק הפועלים.',normalized);
  }
  if(normalized.length===1)return normalized[0];
  throw accountSelectionError('MULTIPLE_ACCOUNTS','נמצאו כמה חשבונות בבנק הפועלים. יש לבחור סניף ומספר חשבון מדויקים.',normalized);
}

function compactText(value,max=240){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function detailKeyToken(value){return String(value??'').toLowerCase().replace(/[^a-z0-9א-ת]+/g,'')}
function primitiveDetailValue(value){
  if(typeof value==='string')return compactText(value,180);
  if(typeof value==='number'&&Number.isFinite(value))return String(value);
  if(typeof value==='boolean')return value?'כן':'לא';
  return '';
}
function meaningfulDetailValue(value){
  const clean=primitiveDetailValue(value),token=detailKeyToken(clean);
  if(!clean||token==='0'||token==='false'||token==='לא'||token==='none'||token==='null'||token==='undefined')return '';
  return clean;
}
function isDocumentDetailKey(key){const token=detailKeyToken(key);return /(image|scan|document|attachment|file|pdf|base64|binary|photo|צילום|סריק|מסמך|קובץ|תמונה)/i.test(token)}
function isUnsafeTechnicalDetailKey(key){const token=detailKeyToken(key);return /(token|cookie|session|jwt|xsrf|csrf|authorization|html|content|href|url|uri)/i.test(token)}
function isChequeCountKey(key){
  const token=detailKeyToken(key);
  return /((check|cheque|cheq|chk).*(count|quantity|qty|total|numberof)|(count|quantity|qty|total|numberof).*(check|cheque|cheq|chk)|(?:checks|cheques)(?:count|number|total)|(?:count|number|total)(?:checks|cheques)|(?:כמות|מספר)(?:ה)?(?:שיקים|צקים)|(?:שיקים|צקים)(?:כמות|מספר))/.test(token);
}
function isChequeNumberKey(key){
  const token=detailKeyToken(key);
  if(isChequeCountKey(key))return false;
  return /((check|cheque|cheq|chk).*(number|no|num|serial|reference)|(number|no|num|serial|reference).*(check|cheque|cheq|chk)|(?:מספר|מס|אסמכתא)(?:ה)?(?:שיק|צק)$|(?:שיק|צק)(?:מספר|מס|אסמכתא)$)/.test(token);
}
function isTransactionReferenceKey(key){const token=detailKeyToken(key);return /^(transactionnumber|transactionno|referencenumber|reference|אסמכתא|מספרתנועה)$/.test(token)}
function isBankNumberKey(key){return /^(bank|banknumber|bankno|bankcode|בנק|מספרבנק|מסבנק)$/.test(detailKeyToken(key))}
function isBranchNumberKey(key){return /^(branch|branchnumber|branchno|branchcode|סניף|מספרסניף|מססניף)$/.test(detailKeyToken(key))}
function isAccountNumberKey(key){return /^(account|accountnumber|accountno|accountid|חשבון|מספרחשבון|מסחשבון)$/.test(detailKeyToken(key))}
function isChequeAmountKey(key){return /^(amount|sum|checkamount|chequeamount|checksum|chequesum|סכום|סכוםשיק|סכוםצק)$/.test(detailKeyToken(key))}
function isSemanticLabelKey(key){return /^(label|title|name|caption|fieldname|displayname|description|תווית|כותרת|שם)$/.test(detailKeyToken(key))}
function isSemanticValueKey(key){return /^(value|fieldvalue|displayvalue|text|data|ערך|תוכן)$/.test(detailKeyToken(key))}

function depositDescriptionToken(value){return String(value??'').toLowerCase().replace(/[\u05f3\u05f4'’׳״]/g,"'").replace(/\s+/g,' ').trim()}
export function isHapoalimChequeTransaction(txn){
  // Only the bank's activity description is authoritative here. Do not scan beneficiary names:
  // Hebrew names such as "זרצקי" contain the letters צק and previously caused false positives.
  const text=depositDescriptionToken(txn?.activityDescription);
  if(!text)return false;
  return /(?:^|[\s.,;:()\-/])(?:הפק(?:דה|דת)?\.?\s*(?:שיק|שיקים|צ'?ק|צ'?קים)|הפק\.?\s*(?:שיק|שיקים|צ'?ק|צ'?קים))(?:$|[\s.,;:()\-/])/.test(text)
    || /\b(?:check|cheque)s?\s+deposit\b|\bdeposit(?:ed|ing)?\s+(?:check|cheque)s?\b/i.test(text);
}

function semanticPairsFromObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return [];
  const entries=Object.entries(value),pairs=[];
  const labelEntry=entries.find(([key,child])=>isSemanticLabelKey(key)&&meaningfulDetailValue(child));
  const valueEntry=entries.find(([key,child])=>isSemanticValueKey(key)&&meaningfulDetailValue(child));
  if(labelEntry&&valueEntry&&labelEntry[0]!==valueEntry[0])pairs.push([meaningfulDetailValue(labelEntry[1]),valueEntry[1]]);
  for(const [key,child] of entries){if(child===null||child===undefined||typeof child==='object')continue;pairs.push([key,child])}
  return pairs;
}
function normalizeChequeItemObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  let bankNumber='',branchNumber='',accountNumber='',checkNumber='',rowReference='',amount=null,hasDocumentReference=false;
  for(const [rawKey,rawValue] of semanticPairsFromObject(value)){
    const key=String(rawKey||'');
    if(isUnsafeTechnicalDetailKey(key))continue;
    if(isDocumentDetailKey(key)){if(meaningfulDetailValue(rawValue))hasDocumentReference=true;continue}
    const clean=meaningfulDetailValue(rawValue);if(!clean)continue;
    if(isBankNumberKey(key)){bankNumber=compactText(clean,20);continue}
    if(isBranchNumberKey(key)){branchNumber=compactText(clean,20);continue}
    if(isAccountNumberKey(key)){accountNumber=compactText(clean,40);continue}
    if(isChequeNumberKey(key)){checkNumber=compactText(clean,80);continue}
    // In the bank's expanded cheque-deposit table the row reference is presented as
    // "אסמכתא (מס' צ'ק)". Treat a generic reference as the cheque number ONLY when
    // this object is independently proven to be a cheque row by bank+branch+account+amount.
    if(isTransactionReferenceKey(key)){rowReference=compactText(clean,80);continue}
    if(isChequeAmountKey(key)){
      const n=Number(String(clean).replace(/[,\s₪]/g,''));if(Number.isFinite(n)&&n>0)amount=n;
    }
  }
  const fullAccountIdentity=!!(bankNumber&&branchNumber&&accountNumber);
  if(!checkNumber&&fullAccountIdentity&&rowReference)checkNumber=rowReference;
  // Accept only a real cheque row: positive amount plus an explicit cheque number, or a full bank/branch/account identity.
  if(!(Number.isFinite(amount)&&amount>0&&(checkNumber||fullAccountIdentity)))return null;
  return {bankNumber,branchNumber,accountNumber,checkNumber,amount,hasDocumentReference};
}
function chequeItemKey(item){return [item.bankNumber,item.branchNumber,item.accountNumber,item.checkNumber,item.amount].join('|')}

export function normalizeHapoalimAdditionalDetails(payload){
  const checkNumbers=new Set(),items=[],itemKeys=new Set();
  let referenceNumber='',checkCount=null,hasDocumentReference=false;
  const addItem=item=>{if(!item)return;const key=chequeItemKey(item);if(itemKeys.has(key))return;itemKeys.add(key);items.push(item);if(item.checkNumber)checkNumbers.add(item.checkNumber);if(item.hasDocumentReference)hasDocumentReference=true};
  const consumeSemanticField=(key,value)=>{
    if(isUnsafeTechnicalDetailKey(key))return;
    if(isDocumentDetailKey(key)){if(meaningfulDetailValue(value))hasDocumentReference=true;return}
    const clean=meaningfulDetailValue(value);if(!clean)return;
    if(isTransactionReferenceKey(key)&&!referenceNumber){referenceNumber=clean;return}
    if(isChequeCountKey(key)){
      const n=Number(String(clean).replace(/[^0-9.-]/g,''));if(Number.isFinite(n)&&n>0)checkCount=Math.trunc(n);
      return;
    }
    if(isChequeNumberKey(key)&&clean!=='0')checkNumbers.add(clean);
  };
  const visit=(value,path='',depth=0)=>{
    if(depth>5||value===null||value===undefined)return;
    if(Array.isArray(value)){
      if(path&&isChequeNumberKey(path)){for(const child of value.slice(0,50))consumeSemanticField(path,child);return}
      for(const child of value.slice(0,80))visit(child,path,depth+1);
      return;
    }
    if(typeof value!=='object'){if(path)consumeSemanticField(path,value);return}
    addItem(normalizeChequeItemObject(value));
    const entries=Object.entries(value);
    const labelEntry=entries.find(([key,child])=>isSemanticLabelKey(key)&&meaningfulDetailValue(child));
    const valueEntry=entries.find(([key,child])=>isSemanticValueKey(key)&&meaningfulDetailValue(child));
    const consumed=new Set();
    if(labelEntry&&valueEntry&&labelEntry[0]!==valueEntry[0]){
      consumeSemanticField(meaningfulDetailValue(labelEntry[1]),valueEntry[1]);
      consumed.add(labelEntry[0]);consumed.add(valueEntry[0]);
    }
    for(const [rawKey,child] of entries){
      if(consumed.has(rawKey))continue;
      const key=String(rawKey||''),nextPath=path?`${path}.${key}`:key;
      if(isDocumentDetailKey(key)){if(meaningfulDetailValue(child))hasDocumentReference=true;continue}
      if(isUnsafeTechnicalDetailKey(key))continue;
      if(child&&typeof child==='object'){visit(child,nextPath,depth+1);continue}
      consumeSemanticField(key,child);
    }
  };
  visit(payload);
  const cleanItems=items.slice(0,50),numbers=[...checkNumbers].filter(x=>x&&x!=='0').slice(0,50);
  if(cleanItems.length){for(const item of cleanItems){if(item.checkNumber&&!numbers.includes(item.checkNumber))numbers.push(item.checkNumber)}}
  if(checkCount===null&&cleanItems.length)checkCount=cleanItems.length;
  else if(checkCount===null&&numbers.length)checkCount=numbers.length;
  return {referenceNumber:compactText(referenceNumber,100),checkNumbers:numbers,checkCount,checkItems:cleanItems,hasDocumentReference};
}

export function buildHapoalimAdditionalDetailsUrl(baseUrl,pfmDetails,accountId){
  const base=new URL(String(baseUrl||'')),url=new URL(String(pfmDetails||''),base);
  if(url.origin!==base.origin){const e=new Error('כתובת פרטי התנועה אינה שייכת לבנק הפועלים');e.code='UNSAFE_DETAIL_URL';throw e}
  url.searchParams.set('accountId',String(accountId||''));
  url.searchParams.set('lang','he');
  return url.toString();
}
function dateDigits(value){const s=String(value??'').replace(/\D/g,'');return s.length>=8?s.slice(0,8):''}
export function ymdDate(value=new Date()){
  const d=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(d.getTime()))return '';
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');
  return `${y}${m}${day}`;
}
export function isoFromBankDate(value){
  const d=dateDigits(value);if(!d)return null;
  const y=Number(d.slice(0,4)),m=Number(d.slice(4,6)),day=Number(d.slice(6,8));
  const date=new Date(y,m-1,day,12,0,0,0);
  return Number.isFinite(date.getTime())?date.toISOString():null;
}

export function normalizeHapoalimTransaction(txn){
  const outbound=Number(txn?.eventActivityTypeCode)===2;
  const amountNumber=Number(txn?.eventAmount);
  const amount=Number.isFinite(amountNumber)?(outbound?-Math.abs(amountNumber):Math.abs(amountNumber)):0;
  const details=txn?.beneficiaryDetailsData&&typeof txn.beneficiaryDetailsData==='object'?txn.beneficiaryDetailsData:{};
  const memo=[details.partyHeadline,details.partyName,details.messageHeadline,details.messageDetail].map(x=>compactText(x,120)).filter(Boolean).join(' · ');
  const bankReference=compactText(txn?.referenceNumber,100),bankSerial=compactText(txn?.serialNumber,100);
  const identifier=bankReference||bankSerial||compactText(`${txn?.eventDate||''}-${txn?.eventAmount||''}`,100);
  const cheque=isHapoalimChequeTransaction(txn);
  const normalizedExtra=txn?.netunimAdditionalDetails&&typeof txn.netunimAdditionalDetails==='object'?txn.netunimAdditionalDetails:null;
  const checkDetails=cheque?{
    checkNumbers:Array.isArray(normalizedExtra?.checkNumbers)?normalizedExtra.checkNumbers.map(x=>compactText(x,80)).filter(x=>x&&x!=='0').slice(0,50):[],
    checkCount:Number.isFinite(Number(normalizedExtra?.checkCount))&&Number(normalizedExtra.checkCount)>0?Math.trunc(Number(normalizedExtra.checkCount)):null,
    checkItems:Array.isArray(normalizedExtra?.checkItems)?normalizedExtra.checkItems.map(item=>({
      bankNumber:compactText(item?.bankNumber,20),branchNumber:compactText(item?.branchNumber,20),accountNumber:compactText(item?.accountNumber,40),
      checkNumber:compactText(item?.checkNumber,80),amount:Number.isFinite(Number(item?.amount))&&Number(item.amount)>0?Number(item.amount):null,hasDocumentReference:!!item?.hasDocumentReference,
    })).filter(item=>item.amount&&(item.checkNumber||(item.bankNumber&&item.branchNumber&&item.accountNumber))).slice(0,50):[],
    hasDocumentReference:!!normalizedExtra?.hasDocumentReference,
    warning:compactText(txn?.netunimAdditionalDetailsWarning,220),
  }:null;
  return {
    id:identifier,
    date:isoFromBankDate(txn?.eventDate),
    processedDate:isoFromBankDate(txn?.valueDate),
    amount,
    currency:'ILS',
    description:compactText(txn?.activityDescription,180)||'תנועת בנק',
    memo:compactText(memo,260),
    status:Number(txn?.serialNumber)===0?'pending':'completed',
    balanceAfter:txn?.currentBalance===null||txn?.currentBalance===undefined||txn?.currentBalance===''?null:(Number.isFinite(Number(txn.currentBalance))?Number(txn.currentBalance):null),
    bankReference,
    bankSerial,
    cheque,
    checkDetails,
  };
}

export function normalizeRecentTransactions(transactions,limit=HAPOALIM_TRANSACTION_LIMIT){
  const seen=new Set();
  return (Array.isArray(transactions)?transactions:[])
    .map(normalizeHapoalimTransaction)
    .filter(x=>x.id||x.date||x.amount)
    .sort((a,b)=>String(b.date||b.processedDate||'').localeCompare(String(a.date||a.processedDate||'')))
    .filter(x=>{const key=`${x.id}|${x.date}|${x.amount}|${x.description}`;if(seen.has(key))return false;seen.add(key);return true})
    .slice(0,Math.max(0,Number(limit)||0));
}

export function scraperFailureMessage(result){
  const type=String(result?.errorType||'').toUpperCase();
  const raw=String(result?.errorMessage||'').trim();
  if(raw.includes('NETUNIM_INTERACTIVE_AUTH_TIMEOUT'))return ['זמן האימות בבנק הסתיים. פתח שוב אימות בבנק והשלם את הקוד בתוך 10 דקות','INTERACTIVE_AUTH_TIMEOUT'];
  if(raw.includes('NETUNIM_SILENT_AUTH_TIMEOUT'))return ['לא נמצא סשן בנק פעיל ברענון השקט. לחץ „פתח אימות בבנק” פעם אחת כדי לחדש את ההזדהות.','AUTH_REQUIRED'];
  if(raw.includes('NETUNIM_INTERACTIVE_BROWSER_CLOSED'))return ['חלון האימות בבנק נסגר לפני שההתחברות הושלמה','INTERACTIVE_BROWSER_CLOSED'];
  if(type==='INVALID_PASSWORD')return ['פרטי ההתחברות לבנק הפועלים אינם נכונים','INVALID_PASSWORD'];
  if(type==='CHANGE_PASSWORD')return ['בנק הפועלים דורש החלפת סיסמה לפני שניתן להמשיך','CHANGE_PASSWORD'];
  if(type==='ACCOUNT_BLOCKED')return ['הגישה לחשבון נחסמה בבנק הפועלים. יש להיכנס לאתר הבנק ולבדוק את החשבון','ACCOUNT_BLOCKED'];
  if(type==='TIMEOUT')return ['הכניסה לבנק הפועלים לא הסתיימה בזמן. ברענון ידני נסה להשלים אימות בחלון הבנק','TIMEOUT'];
  return [raw?`החיבור לבנק הפועלים נכשל: ${raw}`:'החיבור לבנק הפועלים נכשל','SCRAPE_FAILED'];
}
