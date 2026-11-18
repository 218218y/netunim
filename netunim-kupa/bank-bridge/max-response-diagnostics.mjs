// @ts-check
import { isProviderList, providerRecord } from './credit-value-codec.mjs';

// Structural metadata and bounded business codes only; no HTTP bodies or private values.
const TYPES=['missing','null','array','object','string','number','boolean'];
const OUTCOMES=['verified_rows','verified_empty','unrecognized_schema','transport_failure','provider_unavailable','provider_limit'];
const REASONS=['verified','result_missing','result_null','result_wrong_type','transaction_list_missing','transaction_list_wrong_type',
  'unexpected_nonempty_array','depth_exceeded','invalid_billing_date','inconsistent_purchase_evidence','normalization_failed',
  'schema_validation_failed','transport_failure','non_json','empty_body','provider_no_transactions','provider_unavailable','provider_row_limit','provider_rejected','contradictory_empty_response'];
/** @param {unknown} value */
const type=value=>value===undefined?'missing':value===null?'null':Array.isArray(value)?'array':typeof value;
/** @param {unknown} value */
const keys=value=>value&&typeof value==='object'?Object.keys(value).filter(key=>/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(key)).sort().slice(0,40):[];
/** @param {unknown} value */
const count=value=>Math.min(100000,Math.max(0,typeof value==='number'&&Number.isSafeInteger(value)?value:0));
/** @param {unknown} value */
const businessCode=value=>typeof value==='number'&&Number.isInteger(value)&&Math.abs(value)<=999?value:null;
/** @param {unknown} value */
const status=value=>typeof value==='number'&&Number.isInteger(value)&&value>=100&&value<=599?value:0;
/** @param {string[]} allowed @param {unknown} value @param {string} fallback */
const oneOf=(allowed,value,fallback)=>typeof value==='string'&&allowed.includes(value)?value:fallback;
const BODY_TYPES=['json','empty','non_json','transport_failure','invalid_transport'];

/** @param {unknown} data @param {{httpStatus?:number,bodyType?:string,contentType?:string,bodyLength?:number}} [observation] */
export function maxResponseShape(data,{httpStatus=0,bodyType='unknown',contentType='',bodyLength=0}={}){
  /** @type {{path:string,count:number,sampleKeys:string[]}[]} */
  const arrays=[];let visited=0,truncated=false;
  /** @param {unknown} value @param {string} path @param {number} depth */
  function walk(value,path,depth){
    if(!value||typeof value!=='object')return;
    if(depth>6||visited++>=200||arrays.length>=40){truncated=true;return;}
    if(isProviderList(value)){
      arrays.push({path,count:count(value.length),sampleKeys:keys(value[0])});
      if(value.length)walk(value[0],path+'[]',depth+1);return;
    }
    const record = providerRecord(value);
    if (record) for(const key of keys(record))walk(record[key],path+'.'+key,depth+1);
  }
  walk(data,'$',0);
  const flags=[];
  const envelope = providerRecord(data), result = providerRecord(envelope?.result);
  for(const [prefix, row] of Object.entries({'$':envelope,'$.result':result})) {
    for(const key of ['success','isSuccess','hasData','hasTransactions','isMyMAXCardsFiltered']) {
      const value = row?.[key];
      if(typeof value==='boolean')flags.push({path:prefix+'.'+key,value});
    }
  }
  return {httpStatus:status(httpStatus),
    contentType:/application\/(?:[\w.+-]*\+)?json/i.test(String(contentType))?'json':/text\/html/i.test(String(contentType))?'html':contentType?'other':'unknown',bodyLength:count(bodyLength),flags,
    returnCode:businessCode(envelope?.returnCode),returnCodeType:type(envelope?.returnCode),descriptionType:type(envelope?.rcDesc),
    bodyType:oneOf(BODY_TYPES,bodyType,'unknown'),
    envelopeType:type(data),envelopeKeys:keys(data),resultType:type(envelope?.result),resultKeys:keys(envelope?.result),
    transactionsType:type(result?.transactions),transactionsCount:isProviderList(result?.transactions)?count(result.transactions.length):null,
    arrays,truncated};
}
/** @param {ReturnType<typeof maxResponseShape>} shape @param {unknown} error @param {'fetch'|'parse'|'normalize'} phase */
export function maxResponseDecision(shape,error,phase){
  if(!error)return {outcome:'verified_empty',reason:shape.returnCode===10||shape.returnCode===11?'provider_no_transactions':'verified'};
  const diagnosticReason=oneOf(REASONS,providerRecord(error)?.diagnosticReason,'');
  if(diagnosticReason==='provider_unavailable')return {outcome:'provider_unavailable',reason:'provider_unavailable'};
  if(diagnosticReason==='provider_row_limit')return {outcome:'provider_limit',reason:'provider_row_limit'};
  const transport=phase==='fetch';
  if(diagnosticReason)return {outcome:transport?'transport_failure':'unrecognized_schema',reason:diagnosticReason};
  let reason=transport?'transport_failure':phase==='normalize'?'normalization_failed':'schema_validation_failed';
  if(transport&&shape.bodyType==='non_json')reason='non_json';
  else if(shape.bodyType==='empty')reason='empty_body';
  else if(!transport&&['missing','null'].includes(shape.resultType))reason='result_'+shape.resultType;
  else if(!transport&&shape.resultType!=='object')reason='result_wrong_type';
  else if(!transport&&!['missing','array'].includes(shape.transactionsType))reason='transaction_list_wrong_type';
  return {outcome:transport?'transport_failure':'unrecognized_schema',reason};
}
/** @param {unknown} input */
export function safeMaxResponseEvidence(input){
  const row = providerRecord(input);
  if (!row) return undefined;
  /** @param {unknown} value */
  const safeType=value=>oneOf(TYPES,value,'missing');
  /** @param {unknown} value */
  const safeKeys=value=>isProviderList(value)?value.filter(key=>typeof key==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(key)).slice(0,40):[];
  const flags=(isProviderList(row.flags)?row.flags:[]).flatMap(item=>{
    const flag=providerRecord(item), path=flag?.path, value=flag?.value;
    return typeof path==='string'&&/^\$(?:\.result)?\.(?:success|isSuccess|hasData|hasTransactions|isMyMAXCardsFiltered)$/.test(path)&&typeof value==='boolean'?[{path,value}]:[];
  }).slice(0,10);
  const arrays=(isProviderList(row.arrays)?row.arrays:[]).slice(0,40).map(item=>{
    const array=providerRecord(item), path=array?.path;
    return {path:typeof path==='string'&&/^\$(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,63}|\[\]){0,8}$/.test(path)?path:'[redacted]',count:count(array?.count),sampleKeys:safeKeys(array?.sampleKeys)};
  });
  return {httpStatus:status(row.httpStatus),
    contentType:oneOf(['json','html','other'],row.contentType,'unknown'),bodyLength:count(row.bodyLength),
    returnCode:businessCode(row.returnCode),returnCodeType:safeType(row.returnCodeType),descriptionType:safeType(row.descriptionType),
    flags,
    bodyType:oneOf(BODY_TYPES,row.bodyType,'unknown'),
    envelopeType:safeType(row.envelopeType),envelopeKeys:safeKeys(row.envelopeKeys),resultType:safeType(row.resultType),resultKeys:safeKeys(row.resultKeys),
    transactionsType:safeType(row.transactionsType),transactionsCount:row.transactionsCount===null?null:count(row.transactionsCount),
    arrays,
    truncated:row.truncated===true,tier:oneOf(['core','forecast'],row.tier,''),
    endpoint:'max_month_transactions',outcome:oneOf(OUTCOMES,row.outcome,'unrecognized_schema'),reason:oneOf(REASONS,row.reason,'schema_validation_failed')};
}
/** @param {unknown} input @returns {input is Record<string,unknown>} */
export function optionalMaxMonthFailure(input){
  const error=providerRecord(input), code=error?.code, httpStatus=error?.httpStatus;
  if (!error || typeof code !== 'string') return false;
  if(error?.code==='CREDIT_PROVIDER_PERIOD_UNAVAILABLE'&&error.diagnosticReason==='provider_unavailable')return true;
  if(error?.code==='CREDIT_PROVIDER_ROW_LIMIT_EXCEEDED'&&error.diagnosticReason==='provider_row_limit')return true;
  if(['CREDIT_PROVIDER_SCHEMA_ERROR','CREDIT_PROVIDER_NETWORK_ERROR','CREDIT_PROVIDER_RESPONSE_NOT_JSON'].includes(code))return true;
  return code==='CREDIT_PROVIDER_HTTP_ERROR'&&typeof httpStatus==='number'&&(httpStatus===408||httpStatus>=500&&httpStatus<=599);
}
