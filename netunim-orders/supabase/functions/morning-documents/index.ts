import {createClient} from 'npm:@supabase/supabase-js@2.112.4';

const corsHeaders={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
};
const DOCUMENT_TYPES=new Set([305,320,400]);
const PAYMENT_TYPES=new Set([1,2,3,4]);
const CARD_TYPES=new Set([1,2,3,4,5]);
const REQUEST_TIMEOUT_MS=20_000;
const RECONCILE_MIN_AGE_MS=45_000;
const RECONCILE_RELEASE_AGE_MS=5*60_000;

type OperationState='pending'|'created'|'needs_reconciliation'|'failed';
type JsonRecord=Record<string,unknown>;
type OperationRow={
  owner_id:string;operation_id:string;debt_id:string;request_fingerprint:string;state:OperationState;
  document_type:number;amount:number|string;document_date:string;client_name:string;description:string;
  document_id?:string|null;document_number?:string|null;document_url?:string|null;
  allocation_number?:string|null;allocation_checked_at?:string|null;
  error_code?:string|null;error_message?:string|null;created_at:string;updated_at:string;
};

function envKey(jsonName:string,legacyName:string){
  const raw=Deno.env.get(jsonName);
  if(raw){try{const parsed=JSON.parse(raw)||{};const value=parsed.default||Object.values(parsed).find(item=>typeof item==='string'&&item);if(value)return String(value)}catch{/* legacy fallback */}}
  return Deno.env.get(legacyName)||'';
}
const SUPABASE_URL=Deno.env.get('SUPABASE_URL')||'';
const PUBLISHABLE_KEY=envKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY');
const SECRET_KEY=envKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY');
const MORNING_CLIENT_ID=Deno.env.get('MORNING_CLIENT_ID')||'';
const MORNING_CLIENT_SECRET=Deno.env.get('MORNING_CLIENT_SECRET')||'';
const MORNING_ENV_RAW=(Deno.env.get('MORNING_ENV')||'production').trim().toLowerCase();
const MORNING_ENV_VALID=MORNING_ENV_RAW==='production'||MORNING_ENV_RAW==='sandbox';
const MORNING_ENV=MORNING_ENV_RAW==='sandbox'?'sandbox':'production';
const TOKEN_URL=MORNING_ENV==='sandbox'?'https://api.sandbox.morning.dev/idp/v1/oauth/token':'https://api.morning.co/idp/v1/oauth/token';
const API_BASE=MORNING_ENV==='sandbox'?'https://sandbox.d.greeninvoice.co.il/api/v1':'https://api.greeninvoice.co.il/api/v1';
const admin=createClient(SUPABASE_URL,SECRET_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
let tokenCache={value:'',expiresAt:0};

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json','Cache-Control':'no-store'}})}
function configured(){return !!(SUPABASE_URL&&PUBLISHABLE_KEY&&SECRET_KEY&&MORNING_CLIENT_ID&&MORNING_CLIENT_SECRET&&MORNING_ENV_VALID)}
function dataApiUnavailable(error:any){const status=Number(error?.status||error?.context?.status||0),code=String(error?.code||'').toUpperCase(),message=String(error?.message||'').toUpperCase();return [502,503,504].includes(status)||['PGRST002','PGRST003'].includes(code)||message.includes('PGRST002')||message.includes('PGRST003')}
function dbError(error:any,code='morning_storage_error'){return json({ok:false,code: dataApiUnavailable(error)?'morning_storage_unavailable':code,message:dataApiUnavailable(error)?'אחסון מסמכי Morning אינו זמין כרגע. ההפקה חסומה ליתר ביטחון.':String(error?.message||error||code)},dataApiUnavailable(error)?503:500)}
function isUuid(value:unknown){return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value||''))}
function clean(value:unknown,max:number){return String(value??'').trim().slice(0,max)}
function validDate(value:unknown){const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value||''));if(!match)return false;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),probe=new Date(Date.UTC(year,month-1,day));return probe.getUTCFullYear()===year&&probe.getUTCMonth()===month-1&&probe.getUTCDate()===day}
function amountNumber(value:unknown){const n=Number(value);return Number.isFinite(n)?Math.round(n*100)/100:NaN}
function sameAmount(a:unknown,b:unknown){return Math.abs(Number(a||0)-Number(b||0))<0.01}
function normalizeText(value:unknown){return String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('he')}
function validateTaxId(value:unknown){const digits=String(value||'').replace(/\D/g,'');if(!digits)return'';if(digits.length>9)throw new Error('invalid_tax_id');const padded=digits.padStart(9,'0');let sum=0;for(let i=0;i<9;i++){let product=Number(padded[i])*((i%2)+1);if(product>9)product-=9;sum+=product}if(sum%10!==0)throw new Error('invalid_tax_id');return padded}
async function requireUser(req:Request){const authorization=req.headers.get('Authorization')||'',token=authorization.match(/^Bearer\s+(.+)$/i)?.[1]||'';if(!token)return null;const client=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});const {data,error}=await client.auth.getUser(token);if(error||!data.user?.id)return null;return data.user}
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),item=>item.toString(16).padStart(2,'0')).join('')}

class MorningHttpError extends Error{status:number;payload:any;ambiguous:boolean;constructor(message:string,status=0,payload:any=null,ambiguous=false){super(message);this.status=status;this.payload=payload;this.ambiguous=ambiguous}}
async function fetchWithTimeout(url:string,init:RequestInit){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);try{return await fetch(url,{...init,signal:controller.signal})}finally{clearTimeout(timer)}}
async function morningToken(force=false){
  if(!force&&tokenCache.value&&tokenCache.expiresAt>Date.now()+60_000)return tokenCache.value;
  if(!MORNING_CLIENT_ID||!MORNING_CLIENT_SECRET)throw new MorningHttpError('Morning API credentials are not configured',503,null,false);
  let response:Response;
  try{response=await fetchWithTimeout(TOKEN_URL,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:MORNING_CLIENT_ID,client_secret:MORNING_CLIENT_SECRET})})}
  catch(error){throw new MorningHttpError('לא ניתן להגיע לשרת ההזדהות של Morning',0,error,false)}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new MorningHttpError(String(data?.error_description||data?.message||data?.error||'Morning authentication failed'),response.status,data,false);
  const token=String(data?.accessToken||data?.access_token||'').trim();if(!token)throw new MorningHttpError('Morning did not return an access token',502,data,false);
  const rawExpiresAt=Number(data?.expiresAt||0),rawExpiresIn=Number(data?.expiresIn||data?.expires_in||0);let expiresAt=Date.now()+60*60_000;if(Number.isFinite(rawExpiresAt)&&rawExpiresAt>0)expiresAt=rawExpiresAt>1_000_000_000_000?rawExpiresAt:rawExpiresAt*1000;else if(Number.isFinite(rawExpiresIn)&&rawExpiresIn>0)expiresAt=Date.now()+Math.max(60,rawExpiresIn)*1000;
  tokenCache={value:token,expiresAt};return token;
}
async function morningRequest(path:string,init:RequestInit={},authRetry=true){
  const request=async(token:string)=>{let response:Response;try{response=await fetchWithTimeout(API_BASE+path,{...init,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(init.headers||{})}})}catch(error){throw new MorningHttpError('החיבור ל-Morning נותק במהלך הבקשה',0,error,true)}const text=await response.text();let data:any=null;try{data=text?JSON.parse(text):null}catch{data=text}return {response,data}};
  let token=await morningToken(),result=await request(token);
  if(result.response.status===401&&authRetry){tokenCache={value:'',expiresAt:0};token=await morningToken(true);result=await request(token)}
  if(!result.response.ok){const message=String(result.data?.message||result.data?.error?.message||result.data?.error_description||result.data?.error||`Morning HTTP ${result.response.status}`);throw new MorningHttpError(message,result.response.status,result.data,[500,502,503,504].includes(result.response.status))}
  return result.data;
}
async function verifyMorning(){await morningToken();await morningRequest('/businesses/me',{method:'GET'})}

function normalizeInput(body:any){
  const debtId=clean(body?.debt_id,180),operationId=clean(body?.operation_id,80),doc=body?.document||{},type=Number(doc.type),amount=amountNumber(doc.amount),date=String(doc.date||''),dueDate=type===305?clean(doc.dueDate,10):'',description=clean(doc.description,250),remarks=clean(doc.remarks,500),orderNumber=clean(doc.orderNumber,80),clientRaw=doc.client||{},clientName=clean(clientRaw.name,160),email=clean(clientRaw.email,180),phone=clean(clientRaw.phone,50);
  if(!debtId)throw new Error('missing_debt_id');if(operationId&&!isUuid(operationId))throw new Error('invalid_operation_id');if(!DOCUMENT_TYPES.has(type))throw new Error('invalid_document_type');if(!Number.isFinite(amount)||amount<=0)throw new Error('invalid_amount');if(!validDate(date))throw new Error('invalid_document_date');if(dueDate&&(!validDate(dueDate)||dueDate<date))throw new Error('invalid_due_date');if(!description)throw new Error('missing_description');if(!clientName)throw new Error('missing_client_name');if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('invalid_email');const taxId=validateTaxId(clientRaw.taxId);
  const client:any={name:clientName,add:false};if(email)client.emails=[email];if(taxId)client.taxId=taxId;if(phone)client.phone=phone;
  const payload:any={type,description,date,lang:'he',currency:'ILS',vatType:0,signed:true,rounding:false,client,income:[{price:amount,currency:'ILS',quantity:1,description,vatType:1}]};if(dueDate)payload.dueDate=dueDate;if(remarks)payload.remarks=remarks;
  if(type===320||type===400){const payment=doc.payment||{},paymentType=Number(payment.type),paymentDate=String(payment.date||'');if(!PAYMENT_TYPES.has(paymentType)||!validDate(paymentDate))throw new Error('invalid_payment');const line:any={type:paymentType,date:paymentDate,price:amount,currency:'ILS'};
    if(paymentType===4){const transactionId=clean(payment.transactionId,80);if(transactionId)line.transactionId=transactionId}
    if(paymentType===3){const cardType=Number(payment.cardType),cardNum=String(payment.cardNum||'').replace(/\D/g,'');if(!CARD_TYPES.has(cardType)||!/^\d{4}$/.test(cardNum))throw new Error('invalid_card_payment');Object.assign(line,{dealType:1,cardType,cardNum})}
    if(paymentType===2){const bankName=clean(payment.bankName,80),bankBranch=clean(payment.bankBranch,30),bankAccount=clean(payment.bankAccount,40),chequeNum=clean(payment.chequeNum,40);if(!bankName||!bankBranch||!bankAccount||!chequeNum)throw new Error('invalid_check_payment');Object.assign(line,{bankName,bankBranch,bankAccount,chequeNum})}
    payload.payment=[line];
  }
  const linked=clean(doc.linkedDocumentId,80);if(type===400&&linked){if(!isUuid(linked))throw new Error('invalid_linked_document');payload.linkedDocumentIds=[linked]}
  const fingerprintSource={debtId,type,amount,date,dueDate,description,remarks,orderNumber,client:{name:clientName,email,taxId,phone},payment:payload.payment||[],linked:payload.linkedDocumentIds||[]};
  return {debtId,operationId,type,amount,date,dueDate,description,remarks,orderNumber,clientName,linkedDocumentId:linked||'',payload,fingerprintSource};
}
function userMessage(code:string){const messages:Record<string,string>={missing_debt_id:'מזהה החוב חסר',invalid_operation_id:'מזהה הפעולה אינו תקין',invalid_document_type:'סוג המסמך אינו נתמך',invalid_amount:'סכום המסמך אינו תקין',invalid_document_date:'תאריך המסמך אינו תקין',invalid_due_date:'תאריך לתשלום אינו תקין או מוקדם מתאריך המסמך',missing_description:'תיאור המסמך חסר',missing_client_name:'שם הלקוח חסר',invalid_email:'כתובת האימייל אינה תקינה',invalid_tax_id:'מספר העוסק / ח.פ. אינו תקין',invalid_payment:'פרטי התשלום אינם תקינים',invalid_card_payment:'פרטי כרטיס האשראי אינם תקינים',invalid_check_payment:'פרטי הצ׳ק אינם מלאים',invalid_linked_document:'מזהה החשבונית המקושרת אינו תקין'};return messages[code]||'פרטי המסמך אינם תקינים'}
function documentUrl(data:any){if(typeof data?.url==='string'&&/^https:\/\//.test(data.url))return data.url;for(const key of ['he','origin','en']){const value=data?.url?.[key];if(typeof value==='string'&&/^https:\/\//.test(value))return value}return''}
function allocationValue(data:any){const value=data?.allocationNumber??data?.allocation_number??data?.data?.allocationNumber??'';return clean(value,40)}
function documentSummary(data:any,fallback:any){const source=data?.id?data:(data?.data?.id?data.data:data);return {id:String(source?.id||''),number:String(source?.number||''),type:Number(source?.type||fallback.type),amount:Number(source?.amount||source?.amountLocal||fallback.amount),date:String(source?.documentDate||source?.date||fallback.date),url:documentUrl(source),allocationNumber:allocationValue(source)}}
function findPdfBase64(value:any,depth=0):string{if(depth>4||value==null)return'';if(typeof value==='string'){const stripped=value.includes('base64,')?value.split('base64,').pop()||'':value;if(stripped.length>500&&/^[A-Za-z0-9+/=\r\n]+$/.test(stripped))return stripped.replace(/\s/g,'');return''}if(Array.isArray(value)){for(const item of value){const found=findPdfBase64(item,depth+1);if(found)return found}return''}if(typeof value==='object'){for(const key of ['pdf','base64','content','data','file']){const found=findPdfBase64(value[key],depth+1);if(found)return found}for(const item of Object.values(value)){const found=findPdfBase64(item,depth+1);if(found)return found}}return''}

async function readOperations(ownerId:string,debtId:string){const {data,error}=await admin.from('morning_document_operations').select('owner_id,operation_id,debt_id,state,document_type,amount,document_date,document_id,document_number,document_url,allocation_number,allocation_checked_at,error_code,created_at,updated_at').eq('owner_id',ownerId).eq('debt_id',debtId).order('created_at',{ascending:false}).limit(30);if(error)throw error;return (Array.isArray(data)?data:[]) as OperationRow[]}
async function unresolved(ownerId:string,debtId:string){const {data,error}=await admin.from('morning_document_operations').select('*').eq('owner_id',ownerId).eq('debt_id',debtId).in('state',['pending','needs_reconciliation']).order('created_at',{ascending:true});if(error)throw error;return (Array.isArray(data)?data:[]) as OperationRow[]}
async function updateOperation(ownerId:string,operationId:string,patch:JsonRecord){const {error}=await admin.from('morning_document_operations').update({...patch,updated_at:new Date().toISOString()}).eq('owner_id',ownerId).eq('operation_id',operationId);return error}
async function reserveOperation(ownerId:string,input:any,fingerprint:string){
  const {data:existing,error:existingError}=await admin.from('morning_document_operations').select('*').eq('owner_id',ownerId).eq('operation_id',input.operationId).maybeSingle();if(existingError)throw existingError;if(existing){if(existing.request_fingerprint!==fingerprint)throw Object.assign(new Error('operation_id_conflict'),{code:'operation_id_conflict'});return {row:existing as OperationRow,created:false}}
  const row={owner_id:ownerId,operation_id:input.operationId,debt_id:input.debtId,request_fingerprint:fingerprint,state:'pending',document_type:input.type,amount:input.amount,document_date:input.date,client_name:input.clientName,description:input.description};
  const {data,error}=await admin.from('morning_document_operations').insert(row).select('*').single();if(error){if(String(error.code||'')==='23505'){const {data:blocked,error:blockedError}=await admin.from('morning_document_operations').select('*').eq('owner_id',ownerId).eq('debt_id',input.debtId).in('state',['pending','needs_reconciliation']).order('created_at',{ascending:false}).limit(1).maybeSingle();if(blockedError)throw blockedError;throw Object.assign(new Error('debt_operation_unresolved'),{code:'debt_operation_unresolved',blocked})}throw error}return {row:data as OperationRow,created:true};
}

function candidateItems(data:any){if(Array.isArray(data?.items))return data.items;if(Array.isArray(data?.data?.items))return data.data.items;if(Array.isArray(data))return data;return[]}
function matchesCandidate(item:any,row:OperationRow,strict=false){
  if(Number(item?.type)!==Number(row.document_type))return false;if(!sameAmount(item?.amount??item?.amountLocal,row.amount))return false;
  const itemDate=String(item?.documentDate||item?.date||'').slice(0,10),expectedDate=String(row.document_date).slice(0,10);if(strict&&!itemDate)return false;if(itemDate&&itemDate!==expectedDate)return false;
  const expectedClient=normalizeText(row.client_name),actualClient=normalizeText(item?.client?.name||item?.clientName);if(strict&&expectedClient&&actualClient!==expectedClient)return false;if(!strict&&expectedClient&&actualClient&&expectedClient!==actualClient)return false;
  const expectedDescription=normalizeText(row.description),actualDescription=normalizeText(item?.description);if(strict&&expectedDescription&&actualDescription!==expectedDescription)return false;if(!strict&&expectedDescription&&actualDescription&&expectedDescription!==actualDescription)return false;
  return !!item?.id;
}
async function validateLinkedDocument(ownerId:string,input:any){
  if(!input.linkedDocumentId)return null;
  const {data,error}=await admin.from('morning_document_operations').select('document_id').eq('owner_id',ownerId).eq('debt_id',input.debtId).eq('state','created').eq('document_type',305).eq('document_id',input.linkedDocumentId).maybeSingle();
  if(error)throw error;if(!data)throw Object.assign(new Error('linked_document_not_owned'),{code:'linked_document_not_owned'});return data;
}
async function refreshCreatedAllocations(ownerId:string,debtId:string){
  const {data,error}=await admin.from('morning_document_operations').select('*').eq('owner_id',ownerId).eq('debt_id',debtId).eq('state','created').in('document_type',[305,320]).is('allocation_number',null).not('document_id','is',null).order('created_at',{ascending:false}).limit(10);if(error)throw error;
  for(const row of (Array.isArray(data)?data:[]) as OperationRow[]){const id=String(row.document_id||'');if(!isUuid(id))continue;try{const detail=await morningRequest(`/documents/${encodeURIComponent(id)}`,{method:'GET'}),doc=documentSummary(detail,{type:row.document_type,amount:Number(row.amount),date:row.document_date});await updateOperation(ownerId,row.operation_id,{allocation_number:doc.allocationNumber||null,allocation_checked_at:new Date().toISOString(),document_number:doc.number||row.document_number||null,document_url:doc.url||row.document_url||null})}catch(error){console.warn('Morning allocation refresh failed',row.operation_id,error)}}
}
async function reconcileRow(ownerId:string,row:OperationRow){
  const age=Date.now()-new Date(row.updated_at||row.created_at).getTime();if(row.state==='pending'&&age<RECONCILE_MIN_AGE_MS)return row;
  try{
    const searchBody={fromDate:String(row.document_date),toDate:String(row.document_date),type:[Number(row.document_type)],clientName:String(row.client_name),page:1,pageSize:100};
    const data=await morningRequest('/documents/search',{method:'POST',body:JSON.stringify(searchBody)}),coarse=candidateItems(data).filter((item:any)=>matchesCandidate(item,row,false));
    if(coarse.length>20){await updateOperation(ownerId,row.operation_id,{state:'needs_reconciliation',error_code:'too_many_candidates',error_message:'Morning returned too many possible documents'});return {...row,state:'needs_reconciliation'} as OperationRow}
    const verified:any[]=[];for(const item of coarse){const id=String(item?.id||'');if(!isUuid(id))continue;const detail=await morningRequest(`/documents/${encodeURIComponent(id)}`,{method:'GET'});if(matchesCandidate(detail,row,true))verified.push(detail)}
    if(verified.length===1){const doc=documentSummary(verified[0],{type:row.document_type,amount:Number(row.amount),date:row.document_date}),checkedAt=new Date().toISOString(),error=await updateOperation(ownerId,row.operation_id,{state:'created',document_id:doc.id,document_number:doc.number||null,document_url:doc.url||null,allocation_number:doc.allocationNumber||null,allocation_checked_at:checkedAt,error_code:null,error_message:null,client_name:'',description:''});if(error)throw error;return {...row,state:'created',document_id:doc.id,document_number:doc.number,document_url:doc.url,allocation_number:doc.allocationNumber||null,allocation_checked_at:checkedAt,updated_at:checkedAt} as OperationRow}
    if(verified.length>1){await updateOperation(ownerId,row.operation_id,{state:'needs_reconciliation',error_code:'multiple_candidates',error_message:'Morning returned multiple verified documents'});return {...row,state:'needs_reconciliation'} as OperationRow}
    if(age>=RECONCILE_RELEASE_AGE_MS){await updateOperation(ownerId,row.operation_id,{state:'failed',error_code:'reconciliation_not_found',error_message:'No matching Morning document was found',client_name:'',description:''});return {...row,state:'failed'} as OperationRow}
    await updateOperation(ownerId,row.operation_id,{state:'needs_reconciliation',error_code:'waiting_for_reconciliation',error_message:'Waiting before retrying Morning search'});return {...row,state:'needs_reconciliation'} as OperationRow;
  }catch(error){console.error('morning reconciliation failed',row.operation_id,error);await updateOperation(ownerId,row.operation_id,{state:'needs_reconciliation',error_code:'reconciliation_unavailable',error_message:'Morning reconciliation unavailable'});return {...row,state:'needs_reconciliation'} as OperationRow}
}
async function reconcileDebt(ownerId:string,debtId:string){const rows=await unresolved(ownerId,debtId);for(const row of rows)await reconcileRow(ownerId,row)}

async function status(ownerId:string,body:any){const debtId=clean(body?.debt_id,180);if(!debtId)return json({ok:false,code:'missing_debt_id',message:'מזהה החוב חסר'},400);if(!configured())return json({ok:true,configured:false,configuration_error:MORNING_ENV_VALID?null:'invalid_environment',operations:[],unresolved:false,environment:MORNING_ENV_RAW});try{await verifyMorning()}catch(error:any){return json({ok:false,code:'morning_connection_failed',message:String(error?.message||'חיבור Morning נכשל')},503)}try{if(body?.reconcile===true){await reconcileDebt(ownerId,debtId);await refreshCreatedAllocations(ownerId,debtId)}const operations=await readOperations(ownerId,debtId),hasUnresolved=operations.some(row=>['pending','needs_reconciliation'].includes(String(row.state)));return json({ok:true,configured:true,operations,unresolved:hasUnresolved,environment:MORNING_ENV})}catch(error){return dbError(error,'morning_status_failed')}}
async function preview(ownerId:string,body:any){if(!configured())return json({ok:false,code:MORNING_ENV_VALID?'morning_not_configured':'morning_invalid_environment',message:MORNING_ENV_VALID?'Morning אינו מוגדר ב-Supabase':'MORNING_ENV חייב להיות production או sandbox'},503);let input;try{input=normalizeInput(body);await validateLinkedDocument(ownerId,input)}catch(error:any){const code=String(error?.code||error?.message||'invalid_document');return json({ok:false,code,message:code==='linked_document_not_owned'?'החשבונית שנבחרה אינה שייכת לחוב הזה':userMessage(code)},400)}try{const data=await morningRequest('/documents/preview',{method:'POST',body:JSON.stringify(input.payload)}),pdfBase64=findPdfBase64(data);if(!pdfBase64)return json({ok:false,code:'morning_preview_missing_pdf',message:'Morning לא החזירה PDF לתצוגה מקדימה'},502);return json({ok:true,pdfBase64})}catch(error:any){return json({ok:false,code:'morning_preview_failed',message:String(error?.message||'תצוגה מקדימה נכשלה')},error?.status>=400&&error.status<500?400:502)}}
async function create(ownerId:string,body:any){
  if(!configured())return json({ok:false,code:MORNING_ENV_VALID?'morning_not_configured':'morning_invalid_environment',message:MORNING_ENV_VALID?'Morning אינו מוגדר ב-Supabase':'MORNING_ENV חייב להיות production או sandbox'},503);let input;try{input=normalizeInput(body)}catch(error:any){const code=String(error?.message||'invalid_document');return json({ok:false,code,message:userMessage(code)},400)}if(!input.operationId)return json({ok:false,code:'missing_operation_id',message:'מזהה הפעולה חסר'},400);try{await validateLinkedDocument(ownerId,input)}catch(error:any){if(error?.code==='linked_document_not_owned')return json({ok:false,code:'linked_document_not_owned',message:'החשבונית שנבחרה אינה שייכת לחוב הזה'},400);return dbError(error,'morning_link_validation_failed')}const fingerprint=await sha256(JSON.stringify(input.fingerprintSource));let reserved;
  try{reserved=await reserveOperation(ownerId,input,fingerprint)}catch(error:any){if(error?.code==='debt_operation_unresolved')return json({ok:false,code:'morning_operation_unresolved',message:'קיים ניסיון הפקה קודם שעדיין לא אומת. לא נשלח מסמך נוסף.',uncertain:true},409);if(error?.code==='operation_id_conflict')return json({ok:false,code:'morning_operation_conflict',message:'מזהה הפעולה כבר שייך לבקשה אחרת'},409);return dbError(error,'morning_operation_reserve_failed')}
  const row=reserved.row;if(row.state==='created'&&row.document_id)return json({ok:true,replayed:true,document:{id:row.document_id,number:row.document_number,type:row.document_type,amount:Number(row.amount),date:row.document_date,url:row.document_url||'',allocationNumber:row.allocation_number||''}});if(!reserved.created)return json({ok:false,code:'morning_operation_unresolved',message:'ניסיון ההפקה הזה עדיין בבדיקה. לא נשלח מסמך נוסף.',uncertain:true},409);
  try{
    const data=await morningRequest('/documents',{method:'POST',body:JSON.stringify(input.payload)});let doc=documentSummary(data,input);if(!doc.id)throw new MorningHttpError('Morning returned success without a document ID',502,data,true);
    let allocationCheckedAt:string|null=null;try{const detail=await morningRequest(`/documents/${encodeURIComponent(doc.id)}`,{method:'GET'});doc=documentSummary(detail,input);allocationCheckedAt=new Date().toISOString()}catch(error){console.warn('Morning document created; canonical read-back failed',input.operationId,error)}
    const persistError=await updateOperation(ownerId,input.operationId,{state:'created',document_id:doc.id,document_number:doc.number||null,document_url:doc.url||null,allocation_number:doc.allocationNumber||null,allocation_checked_at:allocationCheckedAt,error_code:null,error_message:null,client_name:'',description:''});if(persistError){console.error('Morning document created but metadata persistence failed',input.operationId,persistError);return json({ok:true,document:doc,local_link_pending:true})}
    return json({ok:true,document:doc});
  }catch(error:any){
    const ambiguous=!!error?.ambiguous||[500,502,503,504].includes(Number(error?.status||0));const nextState:OperationState=ambiguous?'needs_reconciliation':'failed';const updateError=await updateOperation(ownerId,input.operationId,{state:nextState,error_code:ambiguous?'creation_uncertain':'morning_create_rejected',error_message:clean(error?.message,500),...(ambiguous?{}:{client_name:'',description:''})});if(updateError)console.error('Morning operation failure persistence failed',input.operationId,updateError);
    return json({ok:false,code:ambiguous?'morning_creation_uncertain':'morning_create_failed',message:ambiguous?'לא ניתן לדעת בוודאות אם Morning כבר הפיקה את המסמך. לא יישלח ניסיון נוסף עד לאימות.':String(error?.message||'Morning דחתה את יצירת המסמך'),uncertain:ambiguous},ambiguous?502:(error?.status>=400&&error.status<500?400:502));
  }
}
async function openDocument(body:any){const id=clean(body?.document_id,80);if(!isUuid(id))return json({ok:false,code:'invalid_document_id',message:'מזהה המסמך אינו תקין'},400);try{const data=await morningRequest(`/documents/${encodeURIComponent(id)}`,{method:'GET'}),url=documentUrl(data);if(url)return json({ok:true,url});try{const links=await morningRequest(`/documents/${encodeURIComponent(id)}/download/links`,{method:'GET'}),fallback=documentUrl({url:links})||documentUrl(links);if(fallback)return json({ok:true,url:fallback})}catch{/* older accounts can still return URL on the document itself */}return json({ok:false,code:'morning_document_url_missing',message:'Morning לא החזירה קישור צפייה למסמך'},502)}catch(error:any){return json({ok:false,code:'morning_document_open_failed',message:String(error?.message||'פתיחת המסמך נכשלה')},error?.status===404?404:502)}}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(req.method!=='POST')return json({ok:false,code:'method_not_allowed'},405);if(!SUPABASE_URL||!PUBLISHABLE_KEY||!SECRET_KEY)return json({ok:false,code:'supabase_backend_not_configured',message:'Supabase Edge Function configuration is incomplete'},503);
  const user=await requireUser(req);if(!user)return json({ok:false,code:'morning_cloud_auth_required',message:'נדרשת התחברות לענן לפני שימוש ב-Morning'},401);const body=await req.json().catch(()=>({})),action=String(body?.action||'');
  if(action==='status')return status(user.id,body);if(action==='preview')return preview(user.id,body);if(action==='create')return create(user.id,body);if(action==='open_document')return openDocument(body);return json({ok:false,code:'morning_unknown_action',message:'פעולת Morning אינה מוכרת'},400);
});
