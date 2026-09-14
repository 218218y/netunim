export const BANK_CHEQUE_IMAGE_BUCKET='bank-cheque-images';
export const BANK_CHEQUE_IMAGE_RETENTION_DAYS=60;
export const BANK_CHEQUE_IMAGE_MAX_BYTES=5*1024*1024;

const IMAGE_KEY_RE=/^[a-f0-9]{64}$/;
const IMAGE_OBJECT_RE=/^(\d{8})_([a-f0-9]{64})\.img$/;
const DAY_MS=86400000;

function cleanImageKey(value){const key=String(value||'').trim().toLowerCase();return IMAGE_KEY_RE.test(key)?key:''}
function dateDigits(value){const match=String(value||'').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);return match?`${match[1]}${match[2]}${match[3]}`:''}
function dateDayNumber(value){const digits=/^\d{8}$/.test(String(value||''))?String(value):dateDigits(value);if(!digits)return null;const y=Number(digits.slice(0,4)),m=Number(digits.slice(4,6)),d=Number(digits.slice(6,8)),time=Date.UTC(y,m-1,d);return Number.isFinite(time)?Math.floor(time/DAY_MS):null}
function currentDayNumber(now=Date.now){const raw=typeof now==='function'?now():now,d=new Date(Number(raw));return Number.isFinite(d.getTime())?Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/DAY_MS):Math.floor(Date.now()/DAY_MS)}
function uidFromSession(session){const direct=String(session?.user?.id||'').trim();if(/^[0-9a-f-]{20,}$/i.test(direct))return direct;const token=String(session?.access_token||'');const part=token.split('.')[1]||'';if(!part)return '';try{const normalized=part.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(part.length/4)*4,'='),json=JSON.parse(globalThis.atob(normalized)),sub=String(json?.sub||'').trim();return /^[0-9a-f-]{20,}$/i.test(sub)?sub:''}catch{return ''}}
function encodeStoragePath(path){return String(path||'').split('/').map(part=>encodeURIComponent(part)).join('/')}
async function responseMessage(response){try{const text=await response.clone().text();if(!text)return '';try{const data=JSON.parse(text);return String(data?.message||data?.error||data?.error_description||text)}catch{return text}}catch{return ''}}
function alreadyExists(status,message){return [400,409].includes(Number(status))&&/already exists|duplicate|resource.*exist|asset.*exist/i.test(String(message||''))}
function validImageBlob(blob){return blob instanceof Blob&&blob.size>0&&blob.size<=BANK_CHEQUE_IMAGE_MAX_BYTES&&/^image\/(?:jpeg|png|webp|gif|bmp)$/i.test(String(blob.type||''))}

export function bankChequeImageWithinRetention(value,{now=Date.now,days=BANK_CHEQUE_IMAGE_RETENTION_DAYS}={}){const itemDay=dateDayNumber(value),today=currentDayNumber(now),age=itemDay===null?NaN:today-itemDay;return Number.isFinite(age)&&age>=0&&age<Math.max(1,Number(days)||BANK_CHEQUE_IMAGE_RETENTION_DAYS)}
export function bankChequeImageObjectPath(userId,eventDate,imageKey){const uid=String(userId||'').trim(),date=dateDigits(eventDate),key=cleanImageKey(imageKey);if(!uid||!date||!key)return '';return `${uid}/${date}_${key}.img`}
const IMAGE_DOWNLOAD_EXTENSIONS=new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],['image/gif','gif'],['image/bmp','bmp']]);

export function bankChequeImageDownloadName(eventDate,label='image',mimeType=''){
  const date=dateDigits(eventDate)||'undated',side=/גב|back/i.test(String(label||''))?'back':/חזית|front/i.test(String(label||''))?'front':'image',ext=IMAGE_DOWNLOAD_EXTENSIONS.get(String(mimeType||'').toLowerCase())||'img';
  return `bank-cheque_${date}_${side}.${ext}`;
}

export function retainBankChequeImagePreviewUrl(url,{image,backdrop,pageTarget=globalThis,MutationObserverImpl=globalThis.MutationObserver,revokeObjectUrl=value=>globalThis.URL?.revokeObjectURL?.(value)}={}){
  const value=String(url||'').trim();let released=false,observer=null;
  const release=()=>{if(released)return;released=true;observer?.disconnect?.();image?.removeEventListener?.('error',release);pageTarget?.removeEventListener?.('pagehide',release);if(value)revokeObjectUrl(value)};
  if(!value)return release;
  image?.addEventListener?.('error',release,{once:true});
  pageTarget?.addEventListener?.('pagehide',release,{once:true});
  const check=()=>{if(!image?.isConnected||!backdrop?.classList?.contains?.('open'))release()};
  if(typeof MutationObserverImpl==='function'&&backdrop){observer=new MutationObserverImpl(check);observer.observe(backdrop,{attributes:true,attributeFilter:['class','aria-hidden'],childList:true,subtree:true})}
  check();
  return release;
}

export function bankChequeImageReferences(transactions,{now=Date.now,days=BANK_CHEQUE_IMAGE_RETENTION_DAYS}={}){
  const refs=new Map();
  for(const tx of Array.isArray(transactions)?transactions:[]){
    const eventDate=String(tx?.date||tx?.processedDate||''),date=dateDigits(eventDate);if(!date||!bankChequeImageWithinRetention(eventDate,{now,days}))continue;
    for(const item of Array.isArray(tx?.checkDetails?.checkItems)?tx.checkDetails.checkItems:[]){
      for(const [side,rawKey] of [['front',item?.imageFrontKey],['back',item?.imageBackKey]]){
        const key=cleanImageKey(rawKey);if(!key)continue;
        const referenceId=`${date}:${key}`;if(!refs.has(referenceId))refs.set(referenceId,{key,side,eventDate});
      }
    }
  }
  return [...refs.values()].sort((a,b)=>String(b.eventDate).localeCompare(String(a.eventDate))||a.key.localeCompare(b.key));
}

function parseOwnedObject(userId,item){const raw=String(item?.name||'').trim();if(!raw)return null;const full=raw.startsWith(`${userId}/`)?raw:`${userId}/${raw}`,base=full.slice(userId.length+1),match=base.match(IMAGE_OBJECT_RE);if(!match)return null;return {path:full,date:match[1],key:match[2]}}

export function createBankChequeImageStorage({supaFetch,ensureSession,fetchBridgeImage,now=Date.now}={}){
  if(typeof supaFetch!=='function'||typeof ensureSession!=='function')throw new Error('bank cheque image storage dependencies are missing');
  async function identity(){const session=await ensureSession(),userId=uidFromSession(session);if(!userId)throw Object.assign(new Error('לא ניתן לזהות את משתמש הענן עבור תמונות השיקים'),{code:'CHEQUE_IMAGE_CLOUD_IDENTITY_MISSING'});return {session,userId}}
  async function listOwned(userId){
    const out=[];for(let offset=0;offset<10000;offset+=1000){const response=await supaFetch(`/storage/v1/object/list/${BANK_CHEQUE_IMAGE_BUCKET}`,{method:'POST',body:JSON.stringify({prefix:userId,limit:1000,offset,sortBy:{column:'name',order:'asc'}}),networkTimeoutMs:30000});if(!response.ok){const message=await responseMessage(response);throw Object.assign(new Error(message||'אחסון תמונות השיקים בענן עדיין לא הוכן'),{code:'CHEQUE_IMAGE_STORAGE_NOT_READY',httpStatus:response.status})}const rows=await response.json().catch(()=>[]);if(!Array.isArray(rows))break;out.push(...rows);if(rows.length<1000)break}return out.map(item=>parseOwnedObject(userId,item)).filter(Boolean)
  }
  async function upload(userId,ref){
    if(typeof fetchBridgeImage!=='function')return {uploaded:false,reason:'bridge-image-reader-missing'};
    const path=bankChequeImageObjectPath(userId,ref.eventDate,ref.key);if(!path)return {uploaded:false,reason:'invalid-reference'};
    const blob=await fetchBridgeImage(ref.key);if(!validImageBlob(blob))return {uploaded:false,reason:'invalid-image'};
    const bytes=await blob.arrayBuffer();
    const response=await supaFetch(`/storage/v1/object/${BANK_CHEQUE_IMAGE_BUCKET}/${encodeStoragePath(path)}`,{method:'POST',headers:{'Content-Type':blob.type,'cache-control':'max-age=3600','x-upsert':'false'},body:bytes,networkTimeoutMs:60000});
    if(response.ok)return {uploaded:true,path};const message=await responseMessage(response);if(alreadyExists(response.status,message))return {uploaded:false,exists:true,path};throw Object.assign(new Error(message||`העלאת תמונת שיק נכשלה (${response.status})`),{code:'CHEQUE_IMAGE_UPLOAD_FAILED',httpStatus:response.status})
  }
  async function removePaths(paths){let removed=0;for(let i=0;i<paths.length;i+=1000){const batch=paths.slice(i,i+1000);if(!batch.length)continue;const response=await supaFetch(`/storage/v1/object/${BANK_CHEQUE_IMAGE_BUCKET}`,{method:'DELETE',body:JSON.stringify({prefixes:batch}),networkTimeoutMs:30000});if(!response.ok)throw Object.assign(new Error(await responseMessage(response)||'מחיקת תמונות שיקים ישנות נכשלה'),{code:'CHEQUE_IMAGE_RETENTION_DELETE_FAILED',httpStatus:response.status});removed+=batch.length}return removed}
  async function sync(transactions){
    const {userId}=await identity(),refs=bankChequeImageReferences(transactions,{now}),owned=await listOwned(userId),existing=new Set(owned.map(x=>x.path));let uploaded=0,already=0,missingLocal=0;const warnings=[];
    for(const ref of refs){const path=bankChequeImageObjectPath(userId,ref.eventDate,ref.key);if(existing.has(path)){already++;continue}try{const result=await upload(userId,ref);if(result.uploaded){uploaded++;existing.add(path)}else if(result.exists){already++;existing.add(path)}else missingLocal++}catch(error){warnings.push(error?.message||String(error))}}
    const obsolete=owned.filter(item=>!bankChequeImageWithinRetention(item.date,{now})).map(item=>item.path);let removed=0;if(obsolete.length)try{removed=await removePaths(obsolete)}catch(error){warnings.push(error?.message||String(error))}
    return {ok:warnings.length===0,retentionDays:BANK_CHEQUE_IMAGE_RETENTION_DAYS,referenced:refs.length,uploaded,alreadyPresent:already,missingLocal,removed,warnings:[...new Set(warnings)].slice(0,5)}
  }
  async function download(eventDate,imageKey){
    if(!bankChequeImageWithinRetention(eventDate,{now}))return null;const {userId}=await identity(),path=bankChequeImageObjectPath(userId,eventDate,imageKey);if(!path)return null;
    const response=await supaFetch(`/storage/v1/object/${BANK_CHEQUE_IMAGE_BUCKET}/${encodeStoragePath(path)}`,{method:'GET',headers:{Accept:'image/*'},networkTimeoutMs:30000});if(response.status===404)return typeof fetchBridgeImage==='function'?fetchBridgeImage(cleanImageKey(imageKey)):null;if(!response.ok)throw Object.assign(new Error(await responseMessage(response)||'טעינת תמונת השיק מהענן נכשלה'),{code:'CHEQUE_IMAGE_DOWNLOAD_FAILED',httpStatus:response.status});const blob=await response.blob();if(!validImageBlob(blob))throw Object.assign(new Error('קובץ תמונת השיק בענן אינו בפורמט תמונה נתמך'),{code:'CHEQUE_IMAGE_INVALID_CLOUD_OBJECT'});return blob
  }
  return {sync,download,listOwned};
}
