const MAX_DEPTH=8;
const MAX_ARRAY_ITEMS=80;
const MAX_OBJECT_KEYS=120;
const MAX_STRING_LENGTH=800;
const MAX_EVENTS=200;
const SECRET_KEY_RE=/(?:password|passwd|passcode|authorization|cookie|xsrf|csrf|token|session(?:id|key|token)?|secret|credential|otp|one.?time|pin|usercode|username|userid)/i;
const BINARY_KEY_RE=/(?:image|scan|base64|binary|blob|pdf|documentbytes|filebytes|rawhtml|htmlbody)/i;
const SENSITIVE_QUERY_RE=/(?:accountid|token|session|auth|authorization|xsrf|csrf|cookie|password|passwd|usercode|username|userid|secret|credential|otp|pin)/i;

function text(value,max=MAX_STRING_LENGTH){return String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max)}
function marker(kind,value){const size=typeof value==='string'?value.length:ArrayBuffer.isView(value)?value.byteLength:0;return `[REDACTED_${kind}${size?` length=${size}`:''}]`}
function maybeUrl(value){const raw=String(value||'').trim();return /^(?:https?:\/\/|\/ServerServices\/)/i.test(raw)?raw:''}
function sanitizeUrl(raw){
  try{
    const absolute=/^https?:\/\//i.test(raw),url=new URL(raw,'https://login.bankhapoalim.co.il');
    for(const key of [...url.searchParams.keys()])if(SENSITIVE_QUERY_RE.test(key))url.searchParams.set(key,'[REDACTED]');
    return absolute?`${url.origin}${url.pathname}${url.search}`:`${url.pathname}${url.search}`;
  }catch{return text(raw)}
}
function looksBinaryString(value){const raw=String(value||'');if(raw.length<300)return false;return /^data:/i.test(raw)||(/^[A-Za-z0-9+/=\r\n]+$/.test(raw)&&raw.replace(/\s/g,'').length>600)}
function looksHtml(value){return /<\s*(?:!doctype\s+html|html|body|script|iframe)\b/i.test(String(value||''))}

export function sanitizeBankDiagnosticValue(value,{key='',depth=0}={}){
  if(value===null||value===undefined)return value??null;
  if(SECRET_KEY_RE.test(String(key||'')))return '[REDACTED_SECRET]';
  if(BINARY_KEY_RE.test(String(key||'')))return marker('BINARY',value);
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

export function createBankChequeDiagnosticRun({bridgeVersion=0}={}){
  return {schemaVersion:1,bridgeVersion:Number(bridgeVersion)||0,startedAt:new Date().toISOString(),finishedAt:null,events:[],failure:null};
}

export function recordBankChequeDiagnostic(run,event){
  if(!run||typeof run!=='object'||!Array.isArray(run.events)||run.events.length>=MAX_EVENTS)return false;
  const detailSources=(Array.isArray(event?.detailSources)?event.detailSources:[]).slice(0,8).map(source=>({
    source:text(source?.source,40),
    request:sanitizeUrl(String(source?.request||'')),
    response:sanitizeBankDiagnosticValue(source?.response),
    normalized:sanitizeBankDiagnosticValue(source?.normalized),
    error:source?.error?sanitizeBankDiagnosticValue(source.error):null,
  }));
  run.events.push({
    capturedAt:new Date().toISOString(),
    role:event?.role==='home'?'home':'business',
    chequeKind:text(event?.chequeKind,40),
    transaction:sanitizeBankDiagnosticValue(event?.transaction),
    detailSources,
    mergedAdditionalDetails:sanitizeBankDiagnosticValue(event?.mergedAdditionalDetails),
  });
  return true;
}

export function finishBankChequeDiagnosticRun(run,{failure=null}={}){
  if(!run||typeof run!=='object')return null;
  run.finishedAt=new Date().toISOString();
  if(failure)run.failure=sanitizeBankDiagnosticValue({code:failure?.code||'',stage:failure?.stage||'',httpStatus:Number(failure?.httpStatus)||0,message:failure?.message||String(failure)});
  return run;
}

export function bankChequeDiagnosticFilename(run){
  const stamp=String(run?.finishedAt||run?.startedAt||new Date().toISOString()).replace(/[:.]/g,'-');
  return `netunim-bank-cheque-diagnostic_${stamp}.txt`;
}

export function formatBankChequeDiagnosticText(run){
  const payload=sanitizeBankDiagnosticValue(run||{});
  return [
    'NETUNIM BANK CHEQUE DIAGNOSTIC',
    '==============================',
    'This file is created locally by Bank Bridge and is never synchronized to Supabase.',
    'It contains cheque-related bank transaction/detail data needed to diagnose field mapping.',
    'Credentials, cookies, authorization/session tokens, XSRF values, HTML and binary/document payloads are redacted.',
    'The file can still contain financial transaction values. Share it only deliberately.',
    '',
    JSON.stringify(payload,null,2),
    '',
  ].join('\r\n');
}
