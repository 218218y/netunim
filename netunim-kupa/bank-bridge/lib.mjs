export const INTERACTIVE_AUTH_TIMEOUT_MS=10*60*1000;
export const SILENT_AUTH_TIMEOUT_MS=90*1000;
export const HAPOALIM_POST_LOGIN_TIMEOUT_MS=60*1000;
export const HAPOALIM_NAVIGATION_STABLE_MS=1500;
export const HAPOALIM_DATA_RETRY_LIMIT=3;
export const HAPOALIM_TRANSACTION_LOOKBACK_DAYS=30;
export const HAPOALIM_INITIAL_BACKFILL_DAYS=365;
export const HAPOALIM_TRANSACTION_LIMIT=1000;

export function hapoalimTransactionPageState(data,requestedLimit=HAPOALIM_TRANSACTION_LIMIT){
  const transactions=Array.isArray(data?.transactions)?data.transactions:[];
  const reported=Number(data?.numItemsPerPage),requested=Number(requestedLimit);
  const reportedPageSize=Number.isFinite(reported)&&reported>0?Math.trunc(reported):null;
  const effectivePageSize=reportedPageSize||(Number.isFinite(requested)&&requested>0?Math.trunc(requested):0);
  return {transactions,reportedPageSize,effectivePageSize,isFull:effectivePageSize>0&&transactions.length>=effectivePageSize};
}

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
function isChequeAmountKey(key){
  const token=detailKeyToken(key);
  return /^(amount|sum|checkamount|chequeamount|checksum|chequesum|סכום)$/.test(token)
    || /^(?:check|cheque|cheq|chk).*(?:amount|sum)/.test(token)
    || /^(?:amount|sum).*(?:check|cheque|cheq|chk)/.test(token)
    || /^סכום(?:ה)?(?:שיק|צק)/.test(token);
}
function isSemanticLabelKey(key){return /^(label|title|name|caption|header|columnname|field|fieldname|fieldlabel|fielddesc|fielddescription|displayname|displaylabel|description|תווית|כותרת|שם)$/.test(detailKeyToken(key))}
function isSemanticValueKey(key){return /^(value|fieldvalue|formattedvalue|displayvalue|displaytext|displaycontent|text|data|content|ערך|תוכן)$/.test(detailKeyToken(key))}
function explicitChequeNumberFromText(value){
  const text=compactText(value,240);if(!text)return '';
  const match=text.match(/(?:אסמכתא\s*\(\s*מס[׳']?\s*(?:שיק|צ[׳']?ק)\s*\)|מס(?:פר|[׳'])?\s*(?:שיק|צ[׳']?ק)|(?:שיק|צ[׳']?ק)\s*מס(?:פר|[׳'])?)\s*[:=\-–—]?\s*([0-9]{2,20})/u);
  return match?compactText(match[1],80):'';
}

function depositDescriptionToken(value){return String(value??'').toLowerCase().replace(/[\u05f3\u05f4'’׳״]/g,"'").replace(/\s+/g,' ').trim()}
export function hapoalimChequeTransactionKind(txn){
  // Only the bank's activity description is authoritative here. Do not scan beneficiary names:
  // Hebrew names such as "זרצקי" contain the letters צק and previously caused false positives.
  const text=depositDescriptionToken(txn?.activityDescription);
  if(!text)return '';
  if(/(?:^|[\s.,;:()\-/])(?:הפק(?:דה|דת)?\.?\s*(?:שיק|שיקים|צ'?ק|צ'?קים)|הפק\.?\s*(?:שיק|שיקים|צ'?ק|צ'?קים))(?:$|[\s.,;:()\-/])/.test(text)
    || /\b(?:check|cheque)s?\s+deposit\b|\bdeposit(?:ed|ing)?\s+(?:check|cheque)s?\b/i.test(text))return 'deposit';
  if(/^החזרת\s+(?:שיק(?:ים)?|צ'?ק(?:ים)?|המחא(?:ה|ות))(?:$|[\s.:,;()\-–—־])/.test(text)
    || /^(?:שיק|צ'?ק|המחאה)\s+(?:הוחזר|חזר)(?:$|[\s.:,;()\-–—־])/.test(text)
    || /^(?:returned|return)\s+(?:check|cheque)s?(?:$|[\s.:,;()\-–—])/i.test(text))return 'returned';
  if(/^הצ\.?\s*(?:שיק|צ'?ק)\s+חוזר(?:\s*[\-–—־]\s*|\s+)נט$/u.test(text))return 'returned_credit';
  return '';
}
export function isHapoalimChequeTransaction(txn){return hapoalimChequeTransactionKind(txn)==='deposit'}


function normalizedBankDescriptor(value){return compactText(value,220).normalize('NFKC').toLowerCase().replace(/[\u05f3\u05f4'’׳״]/g,'').replace(/\s+/g,' ').trim()}
const CREDIT_SETTLEMENT_PROVIDER_LABELS={visaCal:'כאל',max:'MAX',isracard:'ישראכרט',amex:'אמריקן אקספרס'};
export function hapoalimCreditSettlementProvider(txn){
  if(Number(txn?.eventActivityTypeCode)!==2)return '';
  const description=normalizedBankDescriptor(txn?.activityDescription),english=normalizedBankDescriptor(txn?.englishActionDesc);
  if(description.includes('אמריקן אקספרס')||english.includes('american expr')||english.includes('american express'))return 'amex';
  if(description.includes('ישראכרט')||english.includes('isracard'))return 'isracard';
  if(description.includes('מקס איט פיננס')||english==='max'||english.includes('max finance'))return 'max';
  // Hapoalim truncates CAL's legal name "כרטיסי אשראי לישראל" to "כרטיסי אשראי ל".
  // Require that exact legal-name prefix; VISA alone is a payment network and is not issuer proof.
  if(/^כרטיסי אשראי ל(?:$|[\s.,:;])/u.test(description))return 'visaCal';
  return '';
}
export function isHapoalimCompletedCreditSettlement(txn){return !!hapoalimCreditSettlementProvider(txn)&&Number(txn?.serialNumber)!==0}
export function isHapoalimCreditPermissionDetails(txn){
  if(!hapoalimCreditSettlementProvider(txn))return false;
  const value=String(txn?.details||'').trim();
  if(!value)return false;
  try{const url=new URL(value,'https://login.bankhapoalim.co.il');return /^\/ServerServices\/current-account\/permissions\//i.test(url.pathname)}catch{return false}
}
function isExplicitCardNumberKey(key){
  const token=detailKeyToken(key);
  return /(?:creditcard|card).*(?:number|no|num|last4|lastfour|lastdigits|suffix)|(?:number|no|num|last4|lastfour|lastdigits|suffix).*(?:creditcard|card)|(?:מספר|מס)(?:ה)?כרטיס|כרטיס(?:מספר|מס)|(?:4|ארבע)(?:ה)?ספרות(?:ה)?אחרונות(?:של)?(?:ה)?כרטיס|ספרותאחרונות(?:של)?(?:ה)?כרטיס/.test(token);
}
function explicitCardLast4(value){
  const clean=meaningfulDetailValue(value);if(!clean)return '';
  const digits=String(clean).replace(/\D/g,'');
  return digits.length>=4&&digits.length<=19?digits.slice(-4):'';
}
export function normalizeHapoalimCreditPermissionDetails(payload){
  const cardLast4s=new Set();
  const consume=(key,value)=>{
    if(isUnsafeTechnicalDetailKey(key)||isDocumentDetailKey(key)||!isExplicitCardNumberKey(key))return;
    const suffix=explicitCardLast4(value);if(suffix)cardLast4s.add(suffix);
  };
  const visit=(value,path='',depth=0)=>{
    if(depth>7||value===null||value===undefined)return;
    if(Array.isArray(value)){for(const child of value.slice(0,120))visit(child,path,depth+1);return}
    if(typeof value!=='object'){if(path)consume(path,value);return}
    const entries=Object.entries(value);
    const labelEntry=entries.find(([key,child])=>isSemanticLabelKey(key)&&meaningfulDetailValue(child));
    const valueEntry=entries.find(([key,child])=>isSemanticValueKey(key)&&meaningfulDetailValue(child));
    const consumed=new Set();
    if(labelEntry&&valueEntry&&labelEntry[0]!==valueEntry[0]){
      consume(meaningfulDetailValue(labelEntry[1]),valueEntry[1]);consumed.add(labelEntry[0]);consumed.add(valueEntry[0]);
    }
    for(const [rawKey,child] of entries){
      if(consumed.has(rawKey))continue;
      const key=String(rawKey||''),nextPath=path?`${path}.${key}`:key;
      if(isUnsafeTechnicalDetailKey(key)||isDocumentDetailKey(key))continue;
      if(child&&typeof child==='object')visit(child,nextPath,depth+1);else consume(nextPath,child);
    }
  };
  visit(payload);
  return {cardLast4s:[...cardLast4s].sort().slice(0,20)};
}
export function mergeHapoalimCreditPermissionDetails(...sources){
  const cardLast4s=new Set();
  for(const source of sources)for(const suffix of Array.isArray(source?.cardLast4s)?source.cardLast4s:[]){const clean=String(suffix||'').replace(/\D/g,'');if(/^\d{4}$/.test(clean))cardLast4s.add(clean)}
  return {cardLast4s:[...cardLast4s].sort().slice(0,20)};
}
function normalizedCreditSettlementDetails(txn,bankReference){
  const provider=hapoalimCreditSettlementProvider(txn);if(!provider)return null;
  const extra=txn?.netunimCreditSettlementDetails&&typeof txn.netunimCreditSettlementDetails==='object'?txn.netunimCreditSettlementDetails:{};
  const cardLast4s=[...new Set((Array.isArray(extra.cardLast4s)?extra.cardLast4s:[]).map(value=>String(value||'').replace(/\D/g,'')).filter(value=>/^\d{4}$/.test(value)))].slice(0,20);
  const permissionLink=isHapoalimCreditPermissionDetails(txn);
  return {
    provider,
    providerLabel:CREDIT_SETTLEMENT_PROVIDER_LABELS[provider]||provider,
    issuerReference:bankReference,
    permissionReference:permissionLink?compactText(txn?.referenceCatenatedNumber,100):'',
    bankActivityTypeCode:Number.isFinite(Number(txn?.activityTypeCode))?Number(txn.activityTypeCode):null,
    bankTextCode:Number.isFinite(Number(txn?.textCode))?Number(txn.textCode):null,
    cardLast4s,
    cardIdentitySource:cardLast4s.length?'bank_detail_explicit':'',
    detailFetched:extra.detailFetched===true,
    warning:compactText(extra.warning,220),
  };
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
function semanticCellPairsFromArray(value){
  if(!Array.isArray(value)||!value.length)return [];
  const pairs=[];let objectCells=0;
  for(const child of value.slice(0,30)){
    if(!child||typeof child!=='object'||Array.isArray(child))return [];
    objectCells++;
    const entries=Object.entries(child);
    // A direct bank/branch/account/amount key means this is probably an array of rows,
    // not an array of cells belonging to one row. Never collapse rows together.
    if(entries.some(([key])=>isBankNumberKey(key)||isBranchNumberKey(key)||isAccountNumberKey(key)||isChequeAmountKey(key)||isChequeNumberKey(key)||isTransactionReferenceKey(key)))return [];
    const labelEntry=entries.find(([key,field])=>isSemanticLabelKey(key)&&meaningfulDetailValue(field));
    const valueEntry=entries.find(([key,field])=>isSemanticValueKey(key)&&meaningfulDetailValue(field));
    if(!labelEntry||!valueEntry||labelEntry[0]===valueEntry[0])return [];
    pairs.push([meaningfulDetailValue(labelEntry[1]),valueEntry[1]]);
  }
  return pairs.length===objectCells?pairs:[];
}
function nestedSemanticPairsFromObject(value,depth=0){
  if(!value||typeof value!=='object'||Array.isArray(value)||depth>3)return [];
  const pairs=semanticPairsFromObject(value);
  for(const [rawKey,child] of Object.entries(value)){
    if(!child||typeof child!=='object')continue;
    const key=String(rawKey||'');
    if(isUnsafeTechnicalDetailKey(key)||isDocumentDetailKey(key))continue;
    if(Array.isArray(child)){
      // Some Hapoalim detail payloads keep a row's display cells in a nested array.
      // Fold them into this row only when EVERY element is an explicit label/value cell.
      // This preserves row identity and never relies on array order alone.
      pairs.push(...semanticCellPairsFromArray(child));
      for(const primitive of child.slice(0,30)){
        if(typeof primitive!=='string')continue;
        const explicit=explicitChequeNumberFromText(primitive);if(explicit)pairs.push(['מספר שיק',explicit]);
      }
      continue;
    }
    pairs.push(...nestedSemanticPairsFromObject(child,depth+1));
  }
  return pairs;
}
function normalizeChequeItemPairs(pairs){
  let bankNumber='',branchNumber='',accountNumber='',checkNumber='',amount=null,hasDocumentReference=false;
  for(const [rawKey,rawValue] of pairs){
    const key=String(rawKey||'');
    if(isUnsafeTechnicalDetailKey(key))continue;
    if(isDocumentDetailKey(key)){if(meaningfulDetailValue(rawValue))hasDocumentReference=true;continue}
    const clean=meaningfulDetailValue(rawValue);if(!clean)continue;
    const inlineChequeNumber=explicitChequeNumberFromText(clean);if(inlineChequeNumber&&!checkNumber)checkNumber=inlineChequeNumber;
    if(isBankNumberKey(key)){if(!bankNumber)bankNumber=compactText(clean,20);continue}
    if(isBranchNumberKey(key)){if(!branchNumber)branchNumber=compactText(clean,20);continue}
    if(isAccountNumberKey(key)){if(!accountNumber)accountNumber=compactText(clean,40);continue}
    if(isChequeNumberKey(key)){if(!checkNumber)checkNumber=compactText(clean,80);continue}
    // A generic transaction/reference field is not a cheque identifier. The current
    // Hapoalim cheque endpoint exposes the cheque number in its dedicated `number`
    // field; labelled semantic cheque-number fields are handled above.
    if(isTransactionReferenceKey(key))continue;
    if(isChequeAmountKey(key)&&amount===null){
      const n=Number(String(clean).replace(/[,\s₪]/g,''));if(Number.isFinite(n)&&n>0)amount=n;
    }
  }
  const fullAccountIdentity=!!(bankNumber&&branchNumber&&accountNumber);
  if(!(Number.isFinite(amount)&&amount>0&&(checkNumber||fullAccountIdentity)))return null;
  return {bankNumber,branchNumber,accountNumber,checkNumber,amount,hasDocumentReference};
}
function normalizeHapoalimChequeListItem(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  // Captured Hapoalim /current-account/cheques/... responses use this exact row
  // contract: {bank, branch, account, number, amount, ...}. `number` is the bank's
  // authoritative cheque number. Do not reinterpret the transaction reference.
  const required=['bank','branch','account','number','amount'];
  if(!required.every(key=>Object.prototype.hasOwnProperty.call(value,key)))return null;
  const bankNumber=compactText(meaningfulDetailValue(value.bank),20);
  const branchNumber=compactText(meaningfulDetailValue(value.branch),20);
  const accountNumber=compactText(meaningfulDetailValue(value.account),40);
  const checkNumber=compactText(meaningfulDetailValue(value.number),80);
  const amountNumber=Number(String(value.amount??'').replace(/[,\s₪]/g,''));
  const amount=Number.isFinite(amountNumber)&&amountNumber>0?amountNumber:null;
  const hasDocumentReference=Object.entries(value).some(([key,child])=>isDocumentDetailKey(key)&&!!meaningfulDetailValue(child));
  if(!bankNumber||!branchNumber||!accountNumber||!amount)return null;
  return {bankNumber,branchNumber,accountNumber,checkNumber,amount,hasDocumentReference};
}
function normalizeChequeItemObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const nativeChequeItem=normalizeHapoalimChequeListItem(value);
  if(nativeChequeItem)return nativeChequeItem;
  // Other Hapoalim views may render a table cell as a nested {label,value}-like
  // object. Fold nested semantic objects into the SAME row; never cross array
  // boundaries (which may hold several cheques).
  return normalizeChequeItemPairs(nestedSemanticPairsFromObject(value));
}
function normalizeChequeItemSemanticArray(value){
  if(!Array.isArray(value)||!value.length)return null;
  const pairs=[];let semanticCells=0,objectCells=0;
  for(const child of value.slice(0,30)){
    if(!child||typeof child!=='object'||Array.isArray(child))continue;
    objectCells++;
    const entries=Object.entries(child);
    // If a child already looks like a row (rather than one label/value cell), this
    // array can contain several cheques and must never be collapsed across rows.
    if(entries.some(([key])=>isBankNumberKey(key)||isBranchNumberKey(key)||isAccountNumberKey(key)||isChequeAmountKey(key)||isChequeNumberKey(key)||isTransactionReferenceKey(key)))return null;
    const labelEntry=entries.find(([key,field])=>isSemanticLabelKey(key)&&meaningfulDetailValue(field));
    const valueEntry=entries.find(([key,field])=>isSemanticValueKey(key)&&meaningfulDetailValue(field));
    if(!labelEntry||!valueEntry||labelEntry[0]===valueEntry[0])continue;
    pairs.push([meaningfulDetailValue(labelEntry[1]),valueEntry[1]]);semanticCells++;
  }
  // Reconstruct only a clearly tabular cheque row: every object in the array must
  // be one semantic cell, and at least four cells are required to prove row shape.
  if(semanticCells<4||semanticCells!==objectCells)return null;
  return normalizeChequeItemPairs(pairs);
}
function semanticColumnLabel(value){
  if(typeof value==='string'||typeof value==='number')return meaningfulDetailValue(value);
  if(!value||typeof value!=='object'||Array.isArray(value))return '';
  for(const [key,child] of Object.entries(value)){if(isSemanticLabelKey(key)){const clean=meaningfulDetailValue(child);if(clean)return clean}}
  return '';
}
function semanticCellValue(value){
  if(value===null||value===undefined)return '';
  if(typeof value!=='object')return value;
  if(Array.isArray(value))return '';
  for(const [key,child] of Object.entries(value)){if(isSemanticValueKey(key)&&meaningfulDetailValue(child))return child}
  return '';
}
function normalizeChequeTableObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return [];
  const arrays=Object.values(value).filter(Array.isArray),headerCandidates=[];
  for(const candidate of arrays){
    if(candidate.length<4||candidate.length>20)continue;
    const labels=candidate.map(semanticColumnLabel);
    if(labels.some(x=>!x))continue;
    // Position-based mapping is accepted only when the bank itself supplied a complete,
    // explicit cheque table header. This is not a guessed column order.
    if(!labels.some(isBankNumberKey)||!labels.some(isBranchNumberKey)||!labels.some(isAccountNumberKey)||!labels.some(isChequeAmountKey)||!labels.some(isChequeNumberKey))continue;
    headerCandidates.push(labels);
  }
  if(headerCandidates.length!==1)return [];
  const labels=headerCandidates[0],items=[];
  const addRow=row=>{
    const cells=Array.isArray(row)?row:(row&&typeof row==='object'?Object.values(row).find(Array.isArray):null);
    if(!Array.isArray(cells)||cells.length<labels.length)return;
    const pairs=labels.map((label,index)=>[label,semanticCellValue(cells[index])]);
    const item=normalizeChequeItemPairs(pairs);if(item)items.push(item);
  };
  for(const candidate of arrays){
    if(candidate.length===labels.length&&candidate.map(semanticColumnLabel).every(Boolean))continue;
    if(candidate.every(row=>Array.isArray(row)||(row&&typeof row==='object')))for(const row of candidate.slice(0,50))addRow(row);
  }
  return items;
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
    const inlineChequeNumber=explicitChequeNumberFromText(clean);if(inlineChequeNumber)checkNumbers.add(inlineChequeNumber);
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
      addItem(normalizeChequeItemSemanticArray(value));
      if(path&&isChequeNumberKey(path)){for(const child of value.slice(0,50))consumeSemanticField(path,child);return}
      for(const child of value.slice(0,80))visit(child,path,depth+1);
      return;
    }
    if(typeof value!=='object'){if(path)consumeSemanticField(path,value);return}
    for(const tableItem of normalizeChequeTableObject(value))addItem(tableItem);
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

export function mergeHapoalimAdditionalDetails(...sources){
  const checkNumbers=new Set(),checkItems=[],itemKeys=new Set();
  let referenceNumber='',declaredCount=0,hasDocumentReference=false;
  for(const source of sources){
    if(!source||typeof source!=='object')continue;
    if(!referenceNumber)referenceNumber=compactText(source.referenceNumber,100);
    const count=Number(source.checkCount);if(Number.isFinite(count)&&count>0)declaredCount=Math.max(declaredCount,Math.trunc(count));
    if(source.hasDocumentReference)hasDocumentReference=true;
    for(const value of Array.isArray(source.checkNumbers)?source.checkNumbers:[]){const clean=compactText(value,80);if(clean&&clean!=='0')checkNumbers.add(clean)}
    for(const raw of Array.isArray(source.checkItems)?source.checkItems:[]){
      const item={
        bankNumber:compactText(raw?.bankNumber,20),branchNumber:compactText(raw?.branchNumber,20),accountNumber:compactText(raw?.accountNumber,40),
        checkNumber:compactText(raw?.checkNumber,80),amount:Number.isFinite(Number(raw?.amount))&&Number(raw.amount)>0?Number(raw.amount):null,hasDocumentReference:!!raw?.hasDocumentReference,
        imageFrontKey:/^[a-f0-9]{64}$/.test(String(raw?.imageFrontKey||''))?String(raw.imageFrontKey):'',imageBackKey:/^[a-f0-9]{64}$/.test(String(raw?.imageBackKey||''))?String(raw.imageBackKey):'',
      };
      if(!item.amount||!(item.checkNumber||(item.bankNumber&&item.branchNumber&&item.accountNumber)))continue;
      const key=chequeItemKey(item);if(itemKeys.has(key))continue;itemKeys.add(key);checkItems.push(item);
      if(item.checkNumber&&item.checkNumber!=='0')checkNumbers.add(item.checkNumber);
      if(item.hasDocumentReference)hasDocumentReference=true;
    }
  }
  const numbers=[...checkNumbers].slice(0,50),items=checkItems.slice(0,50),inferredCount=Math.max(numbers.length,items.length);
  const checkCount=Math.max(declaredCount,inferredCount)||null;
  return {referenceNumber,checkNumbers:numbers,checkCount,checkItems:items,hasDocumentReference};
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
  const creditSettlementDetails=normalizedCreditSettlementDetails(txn,bankReference);
  const identifier=bankReference||bankSerial||compactText(`${txn?.eventDate||''}-${txn?.eventAmount||''}`,100);
  const chequeKind=hapoalimChequeTransactionKind(txn),cheque=chequeKind==='deposit';
  const normalizedExtra=txn?.netunimAdditionalDetails&&typeof txn.netunimAdditionalDetails==='object'?txn.netunimAdditionalDetails:null;
  // For returned-cheque rows, the expanded Hapoalim `details` response is the
  // authoritative cheque identity source. The top-level contra* fields describe the
  // transaction counterparty and are not guaranteed to be the cheque's printed account.
  // v47 synthesized a second row from contra* and caused exactly that corruption.
  const combinedExtra=normalizedExtra;
  const checkDetails=chequeKind?{
    kind:chequeKind,
    checkNumbers:Array.isArray(combinedExtra?.checkNumbers)?combinedExtra.checkNumbers.map(x=>compactText(x,80)).filter(x=>x&&x!=='0').slice(0,50):[],
    checkCount:Number.isFinite(Number(combinedExtra?.checkCount))&&Number(combinedExtra.checkCount)>0?Math.trunc(Number(combinedExtra.checkCount)):null,
    checkItems:Array.isArray(combinedExtra?.checkItems)?combinedExtra.checkItems.map(item=>({
      bankNumber:compactText(item?.bankNumber,20),branchNumber:compactText(item?.branchNumber,20),accountNumber:compactText(item?.accountNumber,40),
      checkNumber:compactText(item?.checkNumber,80),amount:Number.isFinite(Number(item?.amount))&&Number(item.amount)>0?Number(item.amount):null,hasDocumentReference:!!item?.hasDocumentReference,
      imageFrontKey:/^[a-f0-9]{64}$/.test(String(item?.imageFrontKey||''))?String(item.imageFrontKey):'',imageBackKey:/^[a-f0-9]{64}$/.test(String(item?.imageBackKey||''))?String(item.imageBackKey):'',
    })).filter(item=>item.amount&&(item.checkNumber||(item.bankNumber&&item.branchNumber&&item.accountNumber))).slice(0,50):[],
    hasDocumentReference:!!combinedExtra?.hasDocumentReference,
    warning:compactText(txn?.netunimAdditionalDetailsWarning,220),
  }:null;
  if(checkDetails){
    // Cheque identifiers come only from cheque-detail fields supplied by the bank.
    // Transaction/deposit references remain separate metadata and are never promoted
    // to cheque numbers, even when they happen to be equal for a particular row.
    const used=new Set(checkDetails.checkItems.map(item=>item.checkNumber).filter(Boolean));
    const remaining=checkDetails.checkNumbers.filter(number=>!used.has(number));
    const missing=checkDetails.checkItems.filter(item=>!item.checkNumber);
    // A single unmatched bank-supplied cheque number has only one possible row.
    if(missing.length===1&&remaining.length===1){missing[0].checkNumber=remaining[0];used.add(remaining[0])}
    for(const item of checkDetails.checkItems){if(item.checkNumber&&!checkDetails.checkNumbers.includes(item.checkNumber))checkDetails.checkNumbers.push(item.checkNumber)}
  }
  return {
    id:identifier,
    date:isoFromBankDate(txn?.eventDate),
    processedDate:isoFromBankDate(txn?.valueDate),
    amount,
    currency:'ILS',
    description:compactText(txn?.activityDescription,180)||'תנועת בנק',
    memo:compactText(memo,260),
    partyName:compactText(details.partyName,160),
    partyHeadline:compactText(details.partyHeadline,160),
    messageHeadline:compactText(details.messageHeadline,160),
    messageDetail:compactText(details.messageDetail,220),
    activityTypeCode:Number.isFinite(Number(txn?.eventActivityTypeCode))?Number(txn.eventActivityTypeCode):null,
    status:Number(txn?.serialNumber)===0?'pending':'completed',
    balanceAfter:txn?.currentBalance===null||txn?.currentBalance===undefined||txn?.currentBalance===''?null:(Number.isFinite(Number(txn.currentBalance))?Number(txn.currentBalance):null),
    bankReference,
    bankSerial,
    cheque,
    checkDetails,
    creditSettlementDetails,
  };
}

export function normalizeRecentTransactions(transactions,limit=HAPOALIM_TRANSACTION_LIMIT){
  // Preserve every bank row. Hapoalim reference numbers repeat, and even visually identical
  // transactions can be distinct operations. Window fetching is non-overlapping, so silently
  // deduplicating here would risk data loss. Identity/deduplication belongs in the archive merge.
  return (Array.isArray(transactions)?transactions:[])
    .map(normalizeHapoalimTransaction)
    .filter(x=>x.id||x.date||x.amount)
    .sort((a,b)=>String(b.date||b.processedDate||'').localeCompare(String(a.date||a.processedDate||'')))
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
