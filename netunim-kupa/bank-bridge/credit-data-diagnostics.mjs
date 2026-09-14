export const CREDIT_DATA_DIAGNOSTIC_SCHEMA_VERSION=1;
const MAX_FIELDS=120;
const MAX_SAMPLES_PER_CARD=2;

function text(value,max=180){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function suffix(value){const digits=String(value??'').replace(/\D/g,'');return digits?digits.slice(-4):text(value,4)}
function valueType(value){if(value===null)return 'null';if(Array.isArray(value))return 'array';return typeof value==='object'?'object':typeof value}
function numberOrNull(value){if(value===null||value===undefined||String(value).trim()==='')return null;const number=Number(value);return Number.isFinite(number)?number:null}
function sensitivePath(path){return /(?:password|passcode|credential|authorization|auth(?:token)?|access.?token|refresh.?token|(?:^|\.)(?:token|jwt)(?:$|\.)|cookie|session|secret|username|user.?name|national.?id|identity|idnumber|email|phone|address|cardholder|holder.?name|owner.?name)/i.test(path)}
function identifierPath(path){return /(?:^|\.)(?:arn|identifier|transactionid|transaction_id|trnintid|seqvouchernumber|seqconfirmationnumber|voucher(?:number)?|carduniqueid|dealid|requestid)$/i.test(path)}
function cardPath(path){return /(?:card|account).*(?:number|suffix|digits)|shortcardnumber|(?:^|\.)(?:pan|cardpan|iban)$/i.test(path)}
function scalarPreview(path,value){
  if(sensitivePath(path))return '[redacted]';
  if(identifierPath(path))return value===null?'':`…${text(value,12).slice(-6)}`;
  if(cardPath(path))return suffix(value)?`••${suffix(value)}`:'';
  if(typeof value==='number'||typeof value==='boolean')return value;
  return text(value,180);
}
function flatten(value,path='',depth=0,out=[]){
  if(out.length>=MAX_FIELDS||depth>4)return out;
  if(value===null||value===undefined||typeof value!=='object'){
    if(path)out.push({path,type:valueType(value),value:scalarPreview(path,value)});
    return out;
  }
  if(Array.isArray(value)){
    out.push({path:path||'$',type:'array',count:value.length});
    if(value.length)flatten(value[0],`${path||'$'}[0]`,depth+1,out);
    return out;
  }
  const keys=Object.keys(value).sort();
  if(path)out.push({path,type:'object',keys:keys.slice(0,60)});
  for(const key of keys){if(out.length>=MAX_FIELDS)break;flatten(value[key],path?`${path}.${key}`:key,depth+1,out)}
  return out;
}
function clockFromValue(value,{standalone=false}={}){
  const raw=String(value??'').trim();if(!raw)return '';
  const dateTimePattern=/[T\s](\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
  let match=standalone?/^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/.exec(raw):dateTimePattern.exec(raw),dateTimeMatch=!standalone&&!!match;
  if(!match&&standalone&&/^\d{3,4}$/.test(raw)){const compact=raw.padStart(4,'0');match=[raw,compact.slice(0,2),compact.slice(2)]}
  if(!match&&standalone){match=dateTimePattern.exec(raw);dateTimeMatch=!!match}
  if(!match)return '';
  const hour=Number(match[1]),minute=Number(match[2]);if(hour<0||hour>23||minute<0||minute>59)return '';
  const clock=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;
  return dateTimeMatch&&clock==='00:00'?'':clock;
}
const MAX_PURCHASE_TIME_PATH='dealData.purchaseTime';
export function maxRawTransactionTime(rawTransaction){
  const value=rawTransaction?.dealData?.purchaseTime,time=clockFromValue(value,{standalone:true});
  if(!time)return {time:'',sourcePath:'',ambiguous:false,candidates:[]};
  const candidate={path:MAX_PURCHASE_TIME_PATH,time,value};
  return {time,sourcePath:MAX_PURCHASE_TIME_PATH,ambiguous:false,candidates:[candidate]};
}
export function rawTransactionFieldInventory(rawTransaction){return flatten(rawTransaction)}
function normalizedTransactions(account){
  const monthly=(Array.isArray(account?.months)?account.months:[]).flatMap(month=>Array.isArray(month?.transactions)?month.transactions:[]),pending=Array.isArray(account?.pendingTransactions)?account.pendingTransactions:[],unassigned=Array.isArray(account?.unassignedTransactions)?account.unassignedTransactions:[],legacy=Array.isArray(account?.txns)?account.txns:[];
  return [...monthly,...pending,...unassigned,...legacy];
}
function normalizedSample(tx={}){return {id:tx.id?`…${String(tx.id).slice(-6)}`:'',status:text(tx.status,20),type:text(tx.type,30),date:tx.date||null,processedDate:tx.processedDate||null,transactionDate:tx.transactionDate||null,transactionTime:text(tx.transactionTime,8),description:text(tx.description,160),memo:text(tx.memo,180),category:text(tx.category,100),originalAmount:numberOrNull(tx.originalAmount),originalCurrency:text(tx.originalCurrency,12),chargedAmount:numberOrNull(tx.chargedAmount),chargedCurrency:text(tx.chargedCurrency,12),installments:tx.installments&&typeof tx.installments==='object'?{number:Number(tx.installments.number)||null,total:Number(tx.installments.total)||null}:null}}
function sampleRows(rows){
  const source=Array.isArray(rows)?rows:[],selected=[];
  const completed=source.find(tx=>tx?.status!=='pending'),pending=source.find(tx=>tx?.status==='pending');
  if(completed)selected.push(completed);if(pending&&pending!==completed)selected.push(pending);if(!selected.length&&source[0])selected.push(source[0]);
  return selected.slice(0,MAX_SAMPLES_PER_CARD).map(normalizedSample);
}
export function buildCreditDataProfileDiagnostic(profileResult={},rawSamples=[]){
  const provider=text(profileResult.provider,30),profileId=text(profileResult.profileId,80),rawByAccount=new Map((Array.isArray(rawSamples)?rawSamples:[]).map(row=>[suffix(row?.accountNumber),row]));
  return {profileId,provider,label:text(profileResult.label,100),ownerLabel:text(profileResult.ownerLabel,100),accounts:(Array.isArray(profileResult.accounts)?profileResult.accounts:[]).map(account=>{const accountSuffix=suffix(account?.accountNumber),raw=rawByAccount.get(accountSuffix)||null;return {accountSuffix,cardType:text(account?.cardType,80),balance:numberOrNull(account?.balance),balanceDate:account?.balanceDate||null,cardFrame:numberOrNull(account?.cardFrame),availableCredit:numberOrNull(account?.availableCredit),normalizedSamples:sampleRows(normalizedTransactions(account)),rawSample:raw?{fieldInventory:rawTransactionFieldInventory(raw.rawTransaction),timeEvidence:provider==='max'?maxRawTransactionTime(raw.rawTransaction):null}:null}})};
}
export function buildCreditDataDiagnosticPayload({correlationId='',profiles=[],rawSamples=[]}={}){
  const rawByProfile=new Map();for(const row of Array.isArray(rawSamples)?rawSamples:[]){const key=text(row?.profileId,80);if(!rawByProfile.has(key))rawByProfile.set(key,[]);rawByProfile.get(key).push(row)}
  const built=(Array.isArray(profiles)?profiles:[]).map(profile=>buildCreditDataProfileDiagnostic(profile,rawByProfile.get(text(profile?.profileId,80))||[]));
  return {schemaVersion:CREDIT_DATA_DIAGNOSTIC_SCHEMA_VERSION,generatedAt:new Date().toISOString(),correlationId:text(correlationId,80),containsTransactionSamples:true,privacyNote:'הקובץ כולל דוגמאות תנועה מקומיות לצורך אבחון מבנה נתונים. סיסמאות, אסימוני התחברות ומספרי כרטיס/חשבון מלאים אינם נכללים.',profiles:built};
}
export function creditDataDiagnosticFilename(payload={}){const stamp=String(payload.generatedAt||new Date().toISOString()).replace(/[:.]/g,'-');return `netunim-credit-data-diagnostics_${stamp}.json`}
