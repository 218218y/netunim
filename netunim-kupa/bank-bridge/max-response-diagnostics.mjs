// Structural metadata only. Never retain response values, URLs or HTTP bodies.
const TYPES=['missing','null','array','object','string','number','boolean'];
const OUTCOMES=['verified_rows','verified_empty','unrecognized_schema','transport_failure'];
const REASONS=['verified','result_missing','result_null','result_wrong_type','transaction_list_missing','transaction_list_wrong_type',
  'unexpected_nonempty_array','depth_exceeded','invalid_billing_date','inconsistent_purchase_evidence','normalization_failed',
  'schema_validation_failed','transport_failure','non_json','empty_body'];
const type=value=>value===undefined?'missing':value===null?'null':Array.isArray(value)?'array':typeof value;
const keys=value=>value&&typeof value==='object'?Object.keys(value).filter(key=>/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(key)).sort().slice(0,40):[];
const count=value=>Math.min(100000,Math.max(0,Number.isSafeInteger(value)?value:0));
export function maxResponseShape(data,{httpStatus=0,bodyType='unknown',contentType='',bodyLength=0}={}){
  const arrays=[];let visited=0,truncated=false;
  function walk(value,path,depth){
    if(!value||typeof value!=='object')return;
    if(depth>6||visited++>=200||arrays.length>=40){truncated=true;return;}
    if(Array.isArray(value)){
      arrays.push({path,count:count(value.length),sampleKeys:keys(value[0])});
      if(value.length)walk(value[0],path+'[]',depth+1);return;
    }
    for(const key of keys(value))walk(value[key],path+'.'+key,depth+1);
  }
  walk(data,'$',0);
  const flags=[];
  for(const [prefix,value]of [['$',data],['$.result',data?.result]])for(const key of ['success','isSuccess','hasData','hasTransactions'])
    if(typeof value?.[key]==='boolean')flags.push({path:prefix+'.'+key,value:value[key]});
  return {httpStatus:Number.isInteger(httpStatus)&&httpStatus>=100&&httpStatus<=599?httpStatus:0,
    contentType:/application\/(?:[\w.+-]*\+)?json/i.test(String(contentType))?'json':/text\/html/i.test(String(contentType))?'html':contentType?'other':'unknown',bodyLength:count(bodyLength),flags,
    bodyType:['json','empty','non_json','transport_failure','invalid_transport'].includes(bodyType)?bodyType:'unknown',
    envelopeType:type(data),envelopeKeys:keys(data),resultType:type(data?.result),resultKeys:keys(data?.result),
    transactionsType:type(data?.result?.transactions),transactionsCount:Array.isArray(data?.result?.transactions)?count(data.result.transactions.length):null,
    arrays,truncated};
}
export function maxResponseDecision(shape,error,phase){
  if(!error)return {outcome:'verified_empty',reason:'verified'};
  const transport=phase==='fetch';
  let reason=REASONS.includes(error.diagnosticReason)?error.diagnosticReason:transport?'transport_failure':phase==='normalize'?'normalization_failed':'schema_validation_failed';
  if(transport&&shape.bodyType==='non_json')reason='non_json';
  else if(shape.bodyType==='empty')reason='empty_body';
  else if(!transport&&['missing','null'].includes(shape.resultType))reason='result_'+shape.resultType;
  else if(!transport&&shape.resultType!=='object')reason='result_wrong_type';
  else if(!transport&&!['missing','array'].includes(shape.transactionsType))reason='transaction_list_wrong_type';
  return {outcome:transport?'transport_failure':'unrecognized_schema',reason};
}
export function safeMaxResponseEvidence(row){
  if(!row||typeof row!=='object')return undefined;
  const safeType=value=>TYPES.includes(value)?value:'missing';
  const safeKeys=value=>Array.isArray(value)?value.filter(key=>typeof key==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(key)).slice(0,40):[];
  return {httpStatus:Number.isInteger(row.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599?row.httpStatus:0,
    contentType:['json','html','other'].includes(row.contentType)?row.contentType:'unknown',bodyLength:count(row.bodyLength),
    flags:(Array.isArray(row.flags)?row.flags:[]).filter(f=>/^\$(?:\.result)?\.(?:success|isSuccess|hasData|hasTransactions)$/.test(f?.path)&&typeof f.value==='boolean').slice(0,8).map(f=>({path:f.path,value:f.value})),
    bodyType:['json','empty','non_json','transport_failure','invalid_transport'].includes(row.bodyType)?row.bodyType:'unknown',
    envelopeType:safeType(row.envelopeType),envelopeKeys:safeKeys(row.envelopeKeys),resultType:safeType(row.resultType),resultKeys:safeKeys(row.resultKeys),
    transactionsType:safeType(row.transactionsType),transactionsCount:row.transactionsCount===null?null:count(row.transactionsCount),
    arrays:(Array.isArray(row.arrays)?row.arrays:[]).slice(0,40).map(a=>({path:typeof a?.path==='string'&&/^\$(?:\.[a-zA-Z_][a-zA-Z0-9_]{0,63}|\[\]){0,8}$/.test(a.path)?a.path:'[redacted]',count:count(a?.count),sampleKeys:safeKeys(a?.sampleKeys)})),
    truncated:row.truncated===true,tier:['core','forecast'].includes(row.tier)?row.tier:'',
    endpoint:'max_month_transactions',outcome:OUTCOMES.includes(row.outcome)?row.outcome:'unrecognized_schema',reason:REASONS.includes(row.reason)?row.reason:'schema_validation_failed'};
}
export function optionalMaxMonthFailure(error){
  if(['CREDIT_PROVIDER_SCHEMA_ERROR','CREDIT_PROVIDER_NETWORK_ERROR','CREDIT_PROVIDER_RESPONSE_NOT_JSON'].includes(error?.code))return true;
  return error?.code==='CREDIT_PROVIDER_HTTP_ERROR'&&(error.httpStatus===408||error.httpStatus>=500&&error.httpStatus<=599);
}
