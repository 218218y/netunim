const MAX_DEPTH=8;
const MAX_ARRAY_ITEMS=120;
const MAX_OBJECT_KEYS=160;
const MAX_STRING_LENGTH=1200;
const MAX_TRANSACTIONS_PER_ROLE=500;
const MAX_DETAIL_SOURCES=8;
const SECRET_KEY_RE=/(?:password|passwd|passcode|authorization|cookie|xsrf|csrf|token|session(?:id|key|token)?|secret|credential|otp|one.?time|pin|usercode|username|userid)/i;
const BINARY_KEY_RE=/(?:scan|base64|binary|blob|pdf|documentbytes|filebytes|rawhtml|htmlbody|imagebytes|imagedata|imagecontent)/i;
const DOCUMENT_ID_KEY_RE=/^(?:imageId|documentId|scanId)$/i;
const DOCUMENT_LINK_KEY_RE=/^(?:imageFrontLink|imageBackLink|documentLink)$/i;
const SENSITIVE_QUERY_RE=/(?:accountid|token|session|auth|authorization|xsrf|csrf|cookie|password|passwd|usercode|username|userid|secret|credential|otp|pin)/i;

function text(value,max=MAX_STRING_LENGTH){return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max)}
function marker(kind,value){const size=typeof value==='string'?value.length:ArrayBuffer.isView(value)?value.byteLength:0;return `[REDACTED_${kind}${size?` length=${size}`:''}]`}
function maybeUrl(value){const raw=String(value||'').trim();return /^(?:https?:\/\/|\/)/i.test(raw)?raw:''}
function sanitizeUrl(raw){
  try{
    const absolute=/^https?:\/\//i.test(raw),url=new URL(raw,'https://login.bankhapoalim.co.il');
    for(const key of [...url.searchParams.keys()])if(SENSITIVE_QUERY_RE.test(key))url.searchParams.set(key,'[REDACTED]');
    return absolute?`${url.origin}${url.pathname}${url.search}`:`${url.pathname}${url.search}`;
  }catch{return text(raw)}
}
function looksBinaryString(value){const raw=String(value||'');if(raw.length<300)return false;return /^data:/i.test(raw)||(/^[A-Za-z0-9+/=\r\n]+$/.test(raw)&&raw.replace(/\s/g,'').length>600)}
function looksHtml(value){return /<\s*(?:!doctype\s+html|html|body|script|iframe)\b/i.test(String(value||''))}
function roleKey(role){return role==='home'?'home':'business'}
function emptyAccount(){return {summary:null,totalSeen:0,captured:0,truncated:0,transactions:[]}}
function ensureAccount(run,role){
  if(!run.accounts||typeof run.accounts!=='object')run.accounts={business:emptyAccount(),home:emptyAccount()};
  const key=roleKey(role);if(!run.accounts[key])run.accounts[key]=emptyAccount();return run.accounts[key];
}
function rawTransactionOf(entry){return entry?.rawTransaction&&typeof entry.rawTransaction==='object'?entry.rawTransaction:{}}
function normalizedTransactionOf(entry){return entry?.normalizedTransaction&&typeof entry.normalizedTransaction==='object'?entry.normalizedTransaction:{}}
function activitySignature(raw){return [raw?.eventActivityTypeCode,raw?.activityTypeCode,raw?.textCode,raw?.activityDescription,raw?.englishActionDesc].map(value=>String(value??'')).join('|')}
function buildActivitySummary(account){
  const grouped=new Map();
  for(const entry of Array.isArray(account?.transactions)?account.transactions:[]){
    const raw=rawTransactionOf(entry),signature=activitySignature(raw),current=grouped.get(signature)||{
      eventActivityTypeCode:Number.isFinite(Number(raw?.eventActivityTypeCode))?Number(raw.eventActivityTypeCode):null,
      activityTypeCode:Number.isFinite(Number(raw?.activityTypeCode))?Number(raw.activityTypeCode):null,
      textCode:Number.isFinite(Number(raw?.textCode))?Number(raw.textCode):null,
      activityDescription:text(raw?.activityDescription,180),englishActionDesc:text(raw?.englishActionDesc,120),
      transactionType:text(raw?.transactionType,40),count:0,creditCount:0,debitCount:0,hasPfmDetails:false,hasDetails:false,sampleReferences:[],
    };
    current.count++;
    if(Number(raw?.eventActivityTypeCode)===2)current.debitCount++;else if(Number(raw?.eventActivityTypeCode)===1)current.creditCount++;
    current.hasPfmDetails=current.hasPfmDetails||!!raw?.pfmDetails;current.hasDetails=current.hasDetails||!!raw?.details;
    const reference=text(raw?.referenceNumber,100);if(reference&&!current.sampleReferences.includes(reference)&&current.sampleReferences.length<3)current.sampleReferences.push(reference);
    grouped.set(signature,current);
  }
  return [...grouped.values()].sort((a,b)=>b.count-a.count||String(a.activityDescription).localeCompare(String(b.activityDescription),'he'));
}
function fieldInventory(account){
  const rawFields=new Set(),beneficiaryFields=new Set(),normalizedFields=new Set(),checkDetailFields=new Set();
  for(const entry of Array.isArray(account?.transactions)?account.transactions:[]){
    const raw=rawTransactionOf(entry),normalized=normalizedTransactionOf(entry);
    for(const key of Object.keys(raw))rawFields.add(key);
    if(raw?.beneficiaryDetailsData&&typeof raw.beneficiaryDetailsData==='object')for(const key of Object.keys(raw.beneficiaryDetailsData))beneficiaryFields.add(key);
    for(const key of Object.keys(normalized))normalizedFields.add(key);
    const details=normalized?.checkDetails;if(details&&typeof details==='object')for(const key of Object.keys(details))checkDetailFields.add(key);
  }
  return {rawTransactionFields:[...rawFields].sort(),beneficiaryDetailsFields:[...beneficiaryFields].sort(),normalizedTransactionFields:[...normalizedFields].sort(),normalizedCheckDetailFields:[...checkDetailFields].sort()};
}

export function sanitizeBankDiagnosticValue(value,{key='',depth=0}={}){
  if(value===null||value===undefined)return value??null;
  const keyText=String(key||'');
  if(SECRET_KEY_RE.test(keyText))return '[REDACTED_SECRET]';
  if(DOCUMENT_ID_KEY_RE.test(keyText))return marker('DOCUMENT_ID',value);
  if(DOCUMENT_LINK_KEY_RE.test(keyText))return sanitizeUrl(String(value||''));
  if(BINARY_KEY_RE.test(keyText))return marker('BINARY',value);
  if(depth>MAX_DEPTH)return '[TRUNCATED_DEPTH]';
  if(typeof value==='string'){
    const url=maybeUrl(value);if(url)return sanitizeUrl(url);
    if(looksHtml(value))return marker('HTML',value);
    if(looksBinaryString(value))return marker('BINARY',value);
    const clean=String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
    return clean.length>MAX_STRING_LENGTH?`${clean.slice(0,MAX_STRING_LENGTH)}… [TRUNCATED ${clean.length-MAX_STRING_LENGTH}]`:clean;
  }
  if(typeof value==='number'||typeof value==='boolean')return value;
  if(typeof value==='bigint')return value.toString();
  if(ArrayBuffer.isView(value))return marker('BINARY',value);
  if(Array.isArray(value)){
    const out=value.slice(0,MAX_ARRAY_ITEMS).map(child=>sanitizeBankDiagnosticValue(child,{depth:depth+1}));
    if(value.length>MAX_ARRAY_ITEMS)out.push(`[TRUNCATED ${value.length-MAX_ARRAY_ITEMS} ARRAY ITEMS]`);
    return out;
  }
  if(typeof value==='object'){
    const out={},entries=Object.entries(value).slice(0,MAX_OBJECT_KEYS);
    for(const [childKey,child] of entries)out[childKey]=sanitizeBankDiagnosticValue(child,{key:childKey,depth:depth+1});
    if(Object.keys(value).length>MAX_OBJECT_KEYS)out.__truncatedKeys=Object.keys(value).length-MAX_OBJECT_KEYS;
    return out;
  }
  return text(value);
}

export function createBankDiagnosticRun({bridgeVersion=0}={}){
  return {
    schemaVersion:2,bridgeVersion:Number(bridgeVersion)||0,startedAt:new Date().toISOString(),finishedAt:null,
    scope:{source:'latest-bank-sync',maxTransactionsPerRole:MAX_TRANSACTIONS_PER_ROLE,includesAllTransactionTypes:true,chequeDetailResponses:true},
    security:{localOnly:true,synchronizedToSupabase:false,credentialsRedacted:true,sessionSecretsRedacted:true,binaryPayloadsRedacted:true,documentLinksPathOnly:true},
    accounts:{business:emptyAccount(),home:emptyAccount()},failure:null,
  };
}

export function recordBankTransactionDiagnostic(run,event){
  if(!run||typeof run!=='object')return false;
  const account=ensureAccount(run,event?.role);account.totalSeen++;
  if(account.transactions.length>=MAX_TRANSACTIONS_PER_ROLE){account.truncated++;return false}
  const detailSources=(Array.isArray(event?.detailSources)?event.detailSources:[]).slice(0,MAX_DETAIL_SOURCES).map(source=>({
    source:text(source?.source,60),request:sanitizeUrl(String(source?.request||'')),response:sanitizeBankDiagnosticValue(source?.response),normalized:sanitizeBankDiagnosticValue(source?.normalized),error:source?.error?sanitizeBankDiagnosticValue(source.error):null,
  }));
  account.transactions.push({
    capturedAt:new Date().toISOString(),chequeKind:text(event?.chequeKind,40),rawTransaction:sanitizeBankDiagnosticValue(event?.transaction),normalizedTransaction:sanitizeBankDiagnosticValue(event?.normalizedTransaction),detailSources,mergedAdditionalDetails:sanitizeBankDiagnosticValue(event?.mergedAdditionalDetails),
  });
  account.captured=account.transactions.length;return true;
}

export function recordBankAccountDiagnostic(run,event){
  if(!run||typeof run!=='object')return false;
  const account=ensureAccount(run,event?.role);
  account.summary=sanitizeBankDiagnosticValue({
    bankNumber:event?.bankNumber||'12',branchNumber:event?.branchNumber||'',accountNumber:event?.accountNumber||'',balance:event?.balance,availableBalance:event?.availableBalance,creditLimit:event?.creditLimit,creditLimitUsed:event?.creditLimitUsed,creditLimitUsedPercent:event?.creditLimitUsedPercent,transactionCoverage:event?.transactionCoverage||null,transactionWarning:event?.transactionWarning||'',normalizedTransactionCount:Number(event?.normalizedTransactionCount)||0,
  });
  return true;
}

export function finishBankDiagnosticRun(run,{failure=null}={}){
  if(!run||typeof run!=='object')return null;
  run.finishedAt=new Date().toISOString();
  for(const role of ['business','home']){
    const account=ensureAccount(run,role);account.activitySummary=buildActivitySummary(account);account.fieldInventory=fieldInventory(account);
  }
  if(failure)run.failure=sanitizeBankDiagnosticValue({code:failure?.code||'',stage:failure?.stage||'',httpStatus:Number(failure?.httpStatus)||0,message:failure?.message||String(failure)});
  return run;
}

export function bankDiagnosticFilename(run){
  const stamp=String(run?.finishedAt||run?.startedAt||new Date().toISOString()).replace(/[:.]/g,'-');
  return `netunim-bank-diagnostic_${stamp}.json`;
}

export function bankDiagnosticExportPayload(run){return JSON.parse(JSON.stringify(run||{}))}
