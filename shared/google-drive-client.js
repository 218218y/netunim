import {
  SHORTCUT_MIME, MAX_LIST_PAGES, MAX_PREVIEW_BYTES, MAX_TEXT_PREVIEW_BYTES,
  normalizeDocumentFileType, matchesDocumentFileType, driveError, normalizeFile,
  normalizeDocumentSort, compareDocumentRows, driveOrderBy, params,
  resourceKeyHeader, previewDescriptor, buildGoogleDriveQuery, safeGoogleDriveViewUrl,
} from './google-drive-document-policy.js';

const API_ROOT='https://www.googleapis.com/drive/v3';
const BACKEND_PATH='/functions/v1/google-drive-oauth';
const TOKEN_SKEW_MS=30_000;

/**
 * @typedef {{owner: string|null, epoch: number}} AuthenticatedAccountScope
 * @typedef {{authenticatedRequest: (path: string, options: object) => Promise<Response>, fetchRequest: (url: string, options: object) => Promise<Response>}} DriveTransport
 * @typedef {{oauthReturn?: {status: string, code: string}, returnUrl?: () => string, navigate?: (url: string) => void}} DriveBrowser
 */

// Each operation keeps the authenticated owner and authorization epoch it
// entered with. A token refresh may be shared only within that same scope.
/** @param {{accountScope: () => AuthenticatedAccountScope, transport: DriveTransport, browser: DriveBrowser, clock: {now: () => number}}} ports */
export function createGoogleDriveClient({accountScope,transport,browser,clock}){
  if(typeof accountScope!=='function'||typeof transport?.authenticatedRequest!=='function'||typeof transport?.fetchRequest!=='function'||typeof clock?.now!=='function')throw new Error('google_drive_ports_required');
  let owner=null,authEpoch=null,epoch=0,accessToken='',tokenExpiresAt=0,grantedScope='',pendingToken=null;
  const resultCache=new Map(),oauthReturn=browser?.oauthReturn||{status:'',code:''};
  function clearAccess(){accessToken='';tokenExpiresAt=0;grantedScope=''}
  function invalidate(){epoch+=1;clearAccess();pendingToken=null;resultCache.clear()}
  function observeOwner(){
    const scope=accountScope();
    if(!scope||!Number.isSafeInteger(scope.epoch)||scope.epoch<0||!(scope.owner===null||typeof scope.owner==='string'))throw new Error('google_drive_account_scope_invalid');
    const live=String(scope.owner||'').trim()||null;
    if(live!==owner||scope?.epoch!==authEpoch){owner=live;authEpoch=scope?.epoch;invalidate()}
    return {owner,epoch};
  }
  function assertScope(context){
    const live=observeOwner();
    if(!live.owner||live.owner!==context.owner||live.epoch!==context.epoch)
      throw driveError('חשבון הענן או חיבור Google Drive השתנה. יש לבצע את הפעולה מחדש.','GOOGLE_DRIVE_ACCOUNT_CHANGED');
  }
  function check(context){
    if(context.signal?.aborted)throw driveError('הפעולה הקודמת בוטלה.','DOCUMENT_BRIDGE_ABORTED');
    assertScope(context);
  }
  function enter(options){
    if(options?.signal?.aborted)throw driveError('הפעולה הקודמת בוטלה.','DOCUMENT_BRIDGE_ABORTED');
    const context={...observeOwner(),signal:options?.signal||null};
    if(!context.owner)throw driveError('נדרשת התחברות לענן לפני חיבור Google Drive.','google_drive_cloud_auth_required');
    return context;
  }
  async function run(options,operation){
    const context=enter(options);
    const result=await operation(context);
    check(context);
    return result;
  }
  function getToken(){observeOwner();return 'google-drive-managed-oauth'}
  function clearToken(){observeOwner();invalidate()}
  function hasUsableToken(){return !!accessToken&&tokenExpiresAt>clock.now()+TOKEN_SKEW_MS}
  function backendError(data,status){const code=String(data?.code||'google_drive_backend_error');let message=String(data?.message||'').trim();if(code==='google_drive_not_connected')message='Google Drive עדיין לא חובר לחשבון המשתמש הזה.';else if(code==='google_drive_reconnect_required'&&data?.reason==='scope_upgrade_required')message='כדי להציג קבצי Google Drive בתוך האתר נדרש חיבור מחדש ואישור הרשאת צפייה בקבצים.';else if(code==='google_drive_reconnect_required')message='ההרשאה ל-Google Drive פגה או בוטלה. יש לבצע חיבור חד-פעמי מחדש.';else if(code==='google_drive_data_api_unavailable')message='שירות נתוני החיבור ל-Google Drive אינו זמין זמנית.';else if(status===401||code==='google_drive_cloud_auth_required')message='נדרשת התחברות לענן לפני חיבור Google Drive.';else if(!message)message='שירות החיבור ל-Google Drive אינו זמין.';return driveError(message,code,{status,payload:data})}
  async function backend(context,action,payload={}){
    check(context);
    let response;
    try{
      response=await transport.authenticatedRequest(BACKEND_PATH,{method:'POST',networkRetry:false,dataPriority:'high',body:JSON.stringify({action,...payload}),assertRequestScope:()=>check(context)});
    }catch(error){
      check(context);
      if(error?.code==='cloud_auth_required'||String(error?.message||'').includes('לענן'))
        throw driveError('נדרשת התחברות לענן לפני חיבור Google Drive.','google_drive_cloud_auth_required');
      throw error;
    }
    check(context);
    const data=await response.json().catch(()=>({}));
    check(context);
    if(!response.ok)throw backendError(data,response.status);
    return data;
  }
  function acceptToken(context,data){
    check(context);
    const token=String(data?.access_token||'').trim();
    if(!token)throw driveError('Google Drive לא החזיר Access Token תקין.','google_drive_auth_required');
    accessToken=token;grantedScope=String(data?.scope||'');
    tokenExpiresAt=clock.now()+Math.max(0,Number(data?.expires_in)||3600)*1000;
    return token;
  }
  async function restore(context){
    check(context);
    if(hasUsableToken())return accessToken;
    if(!pendingToken){
      // One cancelled caller cannot cancel the token acquisition of another.
      const tokenContext={owner:context.owner,epoch:context.epoch},flight={promise:null};
      flight.promise=backend(tokenContext,'token').then(data=>acceptToken(tokenContext,data)).catch(error=>{
        if(owner===tokenContext.owner&&epoch===tokenContext.epoch)clearAccess();
        throw error;
      }).finally(()=>{if(pendingToken===flight)pendingToken=null});
      pendingToken=flight;
    }
    const token=await pendingToken.promise;
    check(context);
    return token;
  }
  async function beginConnect({returnUrl=''}={}){
    clearToken();
    return run({},async context=>{
      const data=await backend(context,'start',{return_url:String(returnUrl||browser?.returnUrl?.()||'')});
      const url=String(data?.authorize_url||'');
      if(!/^https:\/\/accounts\.google\.com\//.test(url))throw driveError('שירות החיבור ל-Google לא החזיר כתובת הרשאה תקינה.','google_drive_oauth_start_invalid');
      check(context);browser?.navigate?.(url);return false;
    });
  }
  async function disconnect(){
    clearToken();
    const context=enter({});
    await backend(context,'disconnect');check(context);
    invalidate();return true;
  }
  async function apiResponse(context,path,{accept='application/json',resourceId='',resourceKey=''}={}){
    const token=await restore(context),resourceHeader=resourceKeyHeader(resourceId,resourceKey);
    check(context);
    let response;
    try{
      response=await transport.fetchRequest(API_ROOT+path,{headers:{Authorization:`Bearer ${token}`,Accept:accept,...(resourceHeader?{'X-Goog-Drive-Resource-Keys':resourceHeader}:{})},signal:context.signal,cache:'no-store'});
    }catch(error){
      check(context);
      if(error?.name==='AbortError')throw driveError('הפעולה הקודמת בוטלה.','DOCUMENT_BRIDGE_ABORTED');
      throw driveError(error?.message||'אין חיבור ל-Google Drive.','GOOGLE_DRIVE_UNAVAILABLE');
    }
    check(context);
    if(response.status===401&&accessToken===token)clearAccess();
    if(!response.ok){
      const text=await response.text().catch(()=>'');check(context);
      const data=(()=>{try{return text?JSON.parse(text):{}}catch{return {}}})();
      throw driveError(String(data?.error?.message||'')||`Google Drive החזיר שגיאה (${response.status})`,response.status===401?'google_drive_reconnect_required':response.status===403?'GOOGLE_DRIVE_DOWNLOAD_FORBIDDEN':'GOOGLE_DRIVE_API_ERROR',{status:response.status,payload:data});
    }
    return response;
  }
  async function api(context,path,options={}){
    const response=await apiResponse(context,path,options),text=await consume(context,response,'text');
    try{return text?JSON.parse(text):{}}catch{throw driveError('Google Drive החזיר תשובת JSON לא תקינה.','GOOGLE_DRIVE_INVALID_RESPONSE')}
  }
  async function consume(context,response,method){
    let body;
    try{body=await response[method]()}catch(error){check(context);throw driveError(error?.message||'קריאת הקובץ מ-Google Drive נכשלה.','GOOGLE_DRIVE_UNAVAILABLE')}
    check(context);return body;
  }
  const fileFields='id,name,mimeType,modifiedTime,size,fileExtension,webViewLink,resourceKey,capabilities(canDownload),shortcutDetails(targetId,targetMimeType,targetResourceKey)';
  function remember(context,rows){
    check(context);
    for(const row of rows)if(row.id)resultCache.set(row.id,row);
    return rows;
  }
  async function list(context,{query='',limit=150,offset=0,orderBy='modifiedTime desc'}={}){
    const pageLimit=Math.max(1,Math.min(5000,Math.trunc(Number(limit)||150)));
    const pageOffset=Math.max(0,Math.min(5000,Math.trunc(Number(offset)||0)));
    const wanted=Math.min(5001,pageOffset+pageLimit+1),fields=`files(${fileFields}),nextPageToken,incompleteSearch`;
    let pageToken='',incompleteSearch=false,pages=0;
    const rows=[];
    do{
      const pageSize=Math.min(1000,wanted-rows.length);
      const search=params({spaces:'drive',corpora:'user',includeItemsFromAllDrives:'true',supportsAllDrives:'true',pageSize,orderBy,q:query,fields,pageToken});
      const data=await api(context,`/files?${search}`);
      const pageRows=(Array.isArray(data?.files)?data.files:[]).map(normalizeFile).filter(row=>row.id);
      rows.push(...pageRows);incompleteSearch=incompleteSearch||!!data?.incompleteSearch;
      pageToken=String(data?.nextPageToken||'');pages+=1;
    }while(pageToken&&rows.length<wanted&&pages<MAX_LIST_PAGES);
    const page=rows.slice(pageOffset,pageOffset+pageLimit);
    const hasMore=(rows.length>pageOffset+page.length||!!pageToken)&&pageOffset+page.length<5000;
    return {rows:remember(context,page),hasMore,offset:pageOffset,limit:pageLimit,incompleteSearch};
  }
  async function search(context,query,{mode='content',fileType='all',limit=150,offset=0,sort={}}={}){
    const started=clock.now(),normalizedMode=mode==='content'?'content':'everything';
    const normalizedFileType=normalizeDocumentFileType(fileType),normalizedSort=normalizeDocumentSort(sort);
    const queryText=buildGoogleDriveQuery(query,normalizedMode),orderBy=driveOrderBy(normalizedSort);
    const base={ok:true,provider:'google-drive',mode:normalizedMode,fileType:normalizedFileType,sort:normalizedSort};
    if(normalizedMode==='content'&&normalizedFileType==='folders')
      return {...base,results:[],offset:0,limit:Math.max(1,Math.min(5000,Math.trunc(Number(limit)||150))),hasMore:false,elapsedMs:clock.now()-started,incompleteSearch:false};
    if(normalizedFileType==='all'&&orderBy){
      const listed=await list(context,{query:queryText,limit,offset,orderBy});
      return {...base,results:listed.rows,offset:listed.offset,limit:listed.limit,hasMore:listed.hasMore,elapsedMs:clock.now()-started,incompleteSearch:listed.incompleteSearch};
    }
    const pageLimit=Math.max(1,Math.min(5000,Math.trunc(Number(limit)||150)));
    const pageOffset=Math.max(0,Math.min(5000,Math.trunc(Number(offset)||0)));
    const listed=await list(context,{query:queryText,limit:5000,offset:0,orderBy:'modifiedTime desc'});
    const matching=listed.rows.filter(row=>matchesDocumentFileType(row,normalizedFileType));
    const sorted=[...matching].sort((a,b)=>compareDocumentRows(a,b,normalizedSort));
    const rows=remember(context,sorted.slice(pageOffset,pageOffset+pageLimit));
    return {...base,results:rows,offset:pageOffset,limit:pageLimit,hasMore:pageOffset+rows.length<sorted.length,elapsedMs:clock.now()-started,incompleteSearch:listed.incompleteSearch||listed.hasMore};
  }
  async function recent(context,{limit=150,fileType='all'}={}){
    const started=clock.now(),normalizedFileType=normalizeDocumentFileType(fileType);
    const query='trashed = false',boundedLimit=Math.max(1,Math.min(5000,Math.trunc(Number(limit)||150)));
    const listed=await list(context,{query,limit:normalizedFileType==='all'?boundedLimit:5000});
    const results=normalizedFileType==='all'?listed.rows:remember(context,listed.rows.filter(row=>matchesDocumentFileType(row,normalizedFileType)).slice(0,boundedLimit));
    return {ok:true,provider:'google-drive',fileType:normalizedFileType,results,elapsedMs:clock.now()-started,incompleteSearch:listed.incompleteSearch||(normalizedFileType!=='all'&&listed.hasMore)};
  }
  async function resolveById(context,id,{resourceKey='',cache=true}={}){
    check(context);
    const key=String(id||'');
    if(cache&&resultCache.has(key))return resultCache.get(key);
    const data=await api(context,`/files/${encodeURIComponent(key)}?${params({supportsAllDrives:'true',fields:fileFields})}`,{resourceId:key,resourceKey});
    check(context);
    const row=normalizeFile(data);
    if(row.id&&cache)resultCache.set(row.id,row);
    return row;
  }
  async function resolvePreviewTarget(context,id){
    const source=await resolveById(context,id);
    if(source.mimeType!==SHORTCUT_MIME||!source.shortcutTargetId)return {source,target:source};
    const target=await resolveById(context,source.shortcutTargetId,{resourceKey:source.shortcutTargetResourceKey,cache:false});
    return {source,target:{...target,name:source.name||target.name,webViewLink:source.webViewLink||target.webViewLink}};
  }
  async function downloadContent(context,target,descriptor){
    if(target.size!==null&&Number(target.size)>MAX_PREVIEW_BYTES&&!descriptor.exportMime)
      throw driveError('הקובץ גדול מדי לתצוגה מקדימה מהירה בתוך האתר.','PREVIEW_TOO_LARGE');
    const path=descriptor.exportMime?`/files/${encodeURIComponent(target.id)}/export?${params({mimeType:descriptor.exportMime})}`:`/files/${encodeURIComponent(target.id)}?${params({alt:'media',supportsAllDrives:'true'})}`;
    const response=await apiResponse(context,path,{accept:descriptor.mime||'*/*',resourceId:target.id,resourceKey:target.resourceKey});
    const buffer=await consume(context,response,'arrayBuffer');
    if(buffer.byteLength>MAX_PREVIEW_BYTES)throw driveError('הקובץ גדול מדי לתצוגה מקדימה מהירה בתוך האתר.','PREVIEW_TOO_LARGE');
    return new Blob([buffer],{type:descriptor.mime||response.headers?.get?.('content-type')||'application/octet-stream'});
  }
  async function preview(context,id){
    const {source,target}=await resolvePreviewTarget(context,id),descriptor=previewDescriptor(target);
    const base={...source,mimeType:target.mimeType,size:target.size,extension:descriptor.extension||target.extension,canDownload:target.canDownload,source:'google-drive-content',webViewLink:source.webViewLink||target.webViewLink};
    const cloud=previewReason=>({ok:true,kind:'cloud',previewReason,...base});
    if(!descriptor.exportMime&&['binary','structured'].includes(descriptor.kind)&&target.size!==null&&Number(target.size)>MAX_PREVIEW_BYTES)
      return cloud('הקובץ גדול מדי לתצוגה מקדימה מהירה בתוך האתר.');
    if(descriptor.kind==='folder')return cloud('תיקיות נפתחות ב-Google Drive.');
    if(descriptor.kind==='cloud')return cloud(descriptor.reason==='download-restricted'?'הבעלים או מנהל ה-Drive חסם הורדה/ייצוא של הקובץ, ולכן לא ניתן להציג אותו בתוך האתר.':'סוג הקובץ אינו נתמך כרגע במציג הפנימי.');
    if(descriptor.kind==='text'){
      if(!descriptor.exportMime&&target.size!==null&&Number(target.size)>MAX_TEXT_PREVIEW_BYTES)
        return cloud('קובץ הטקסט גדול מדי לתצוגה מקדימה מהירה בתוך האתר.');
      const blob=await downloadContent(context,target,descriptor);
      if(blob.size>MAX_TEXT_PREVIEW_BYTES)return cloud('קובץ הטקסט גדול מדי לתצוגה מקדימה מהירה בתוך האתר.');
      const text=await blob.text();check(context);
      return {ok:true,kind:'text',text,truncated:false,...base};
    }
    return {ok:true,...descriptor,...base};
  }
  async function previewFile(context,id){
    const {target}=await resolvePreviewTarget(context,id),descriptor=previewDescriptor(target);
    if(!['binary','structured'].includes(descriptor.kind))throw driveError('סוג הקובץ אינו נתמך בתצוגה בינארית דרך Google Drive.','PREVIEW_UNSUPPORTED');
    return downloadContent(context,target,descriptor);
  }
  async function openDocument(context,id){
    const row=await resolveById(context,id),url=safeGoogleDriveViewUrl(row.webViewLink);
    if(!url)throw driveError('Google Drive לא החזיר קישור צפייה תקין לקובץ.','GOOGLE_DRIVE_OPEN_URL_MISSING');
    check(context);browser?.navigate?.(url);return {ok:true,url};
  }
  async function status(context){
    const token=await restore(context),data=await api(context,`/about?${params({fields:'user(displayName,emailAddress,permissionId)'})}`);
    return {ok:true,provider:'google-drive',account:data?.user||{},accessTokenReady:!!token,scope:grantedScope,oauthReturn};
  }

  const warm=()=>run({},async context=>{await restore(context);return {ok:true,provider:'google-drive'}});
  return {
    provider:'google-drive',providerLabel:'Google Drive',authKind:'oauth',oauthReturn,
    getToken,clearToken,beginConnect,disconnect,warm,
    status:()=>run({},context=>status(context)),
    recent:(options={})=>run(options,context=>recent(context,options)),
    search:(query,options={})=>run(options,context=>search(context,query,options)),
    preview:(id,options={})=>run(options,context=>preview(context,id)),
    previewFile:(id,options={})=>run(options,context=>previewFile(context,id)),
    openDocument:id=>run({},context=>openDocument(context,id)),
  };
}
