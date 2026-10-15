import path from 'node:path';
import {BRIDGE_VERSION,documentExtension,officePreviewKind,structuredPreviewKind,normalizeSearchScopePath,normalizeSearchText,normalizeContentSearchOptions,buildEsContentPreviewArgs,parseEsContentPreview,buildContentMatchInfo} from './lib.mjs';
import {buildPdfFormMatchAnchors} from './pdf_form_index.mjs';
import {createDocumentPreview,isTextPreview,trimPreviewText} from './preview-content.mjs';
import {createDocumentCommandOwner,joinDocumentReads} from './document-command-owner.mjs';

// Opaque registry resolution captures path/stat authority before every command.
// The returned routes share one accepted-work owner through final audit/index work.
export function createDocumentOperations({registry,preview,pdf,native,search,platform,audit}) {
  const documentResults=registry,previewTextCache=preview.cache,previewFiles=preview.files,nativePreviewSession=native;
  const pdfIndexRuntime=pdf.index,pdfPreviewOperation=pdf.preview;
  const {PDF_FORM_SEARCH_TEXT_REVISION,PDF_FORM_GEOMETRY_REVISION}=pdf.policy;
  async function supplementalPdfData(row,stat){return pdfPreviewOperation.read(row,stat)}
  const loadConfig=search.loadConfig,probeEverything=search.probeEverything,runEs=search.runEs;
  const process=platform.host,execFile=platform.execFile,fs={stat:platform.stat},appendLog=audit.write;
  const runtime=createDocumentCommandOwner();
  const own=command=>(...args)=>runtime.run(()=>command(...args));
  async function resolveResult(id){return documentResults.resolve(id)}
  const nativePreviewCommand=(command,args=[],timeoutMs=6000)=>nativePreviewSession.command(command,args,timeoutMs);
  function normalizePreviewGeometry(value){
    const source=value&&typeof value==='object'?value:{};
    const integer=(name,fallback,min,max)=>Math.max(min,Math.min(max,Math.round(Number(source[name])||fallback)));
    return {
      x:integer('x',0,-20000,20000),
      y:integer('y',0,-20000,20000),
      width:integer('width',900,200,5000),
      height:integer('height',700,160,4000)
    };
  }
  async function openNativePreview(id,geometry){
    const {row,stat}=await resolveResult(id);
    if(stat.isDirectory()){const e=new Error('לתיקייה אין Windows Preview Handler של מסמך.');e.code='NATIVE_PREVIEW_NOT_FILE';throw e}
    const extension=documentExtension(row.fullPath),officeKind=officePreviewKind(extension);
    if(!officeKind){const e=new Error('תצוגת Windows המקורית מופעלת כרגע למסמכי Office בלבד.');e.code='NATIVE_PREVIEW_UNSUPPORTED';throw e}
    const box=normalizePreviewGeometry(geometry),encoded=Buffer.from(row.fullPath,'utf8').toString('base64');
    const response=await nativePreviewCommand('OPEN',[encoded,box.x,box.y,box.width,box.height],9000);
    await appendLog(`NATIVE_PREVIEW_OPEN kind=${officeKind} geometry=${box.x},${box.y},${box.width}x${box.height} handler=${JSON.stringify(response)} path=${JSON.stringify(row.fullPath)}`);
    return {ok:true,kind:'native',officeKind};
  }
  async function moveNativePreview(geometry){
    const box=normalizePreviewGeometry(geometry);
    if(!nativePreviewSession.isRunning())return {ok:true,visible:false};
    await nativePreviewCommand('MOVE',[box.x,box.y,box.width,box.height],2500);
    return {ok:true,visible:true}
  }
  async function hideNativePreview(){if(!nativePreviewSession.isRunning())return {ok:true};try{await nativePreviewCommand('HIDE',[],2500)}catch{}return {ok:true}}
  async function selectSearchFolder(){
    if(process.platform!=='win32'){const e=new Error('בחירת תיקיית חיפוש נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
    const response=await nativePreviewCommand('PICK_FOLDER',[],120000);
    if(response==='CANCELLED')return {ok:true,bridgeVersion:BRIDGE_VERSION,cancelled:true,path:'',label:''};
    const prefix='PICKED ';
    if(!String(response||'').startsWith(prefix)){const e=new Error('בורר התיקיות החזיר תשובה לא תקינה.');e.code='FOLDER_PICKER_INVALID_RESPONSE';throw e}
    let selected='';
    try{selected=Buffer.from(String(response).slice(prefix.length),'base64').toString('utf8')}catch{}
    const normalized=normalizeSearchScopePath(selected);
    if(!normalized){const e=new Error('לא נבחרה תיקייה תקינה.');e.code='FOLDER_PICKER_INVALID_PATH';throw e}
    const label=path.win32.basename(normalized)||path.win32.parse(normalized).root.replace(/[\\]+$/,'')||normalized;
    await appendLog(`SEARCH_SCOPE_PICK path=${JSON.stringify(normalized)}`);
    return {ok:true,bridgeVersion:BRIDGE_VERSION,cancelled:false,path:normalized,label};
  }
  async function readEverythingContentPreview(fullPath){
  try{
      const config=await loadConfig(),probe=await probeEverything({autoStart:true});
      const args=buildEsContentPreviewArgs({fullPath,timeoutMs:config.searchTimeoutMs,instance:probe.instance});
      const {stdout}=await runEs(probe.esPath,args,{timeout:config.searchTimeoutMs+5000});
      const content=parseEsContentPreview(stdout);
      if(!content)return null;
      return trimPreviewText(content);
    }catch(error){await appendLog(`PREVIEW_CONTENT_FAILED path=${JSON.stringify(fullPath)} error=${JSON.stringify(String(error?.message||error))}`);return null}
}
  async function loadSearchablePreviewText(row,stat){
    const extension=documentExtension(row.fullPath);
    let data=null;
    if(isTextPreview(extension)){const direct=await previewFiles.readText(row.fullPath);data={...direct,source:'file'}}
  else if(extension==='pdf'){
      const [everythingText,pdfData]=await joinDocumentReads([readEverythingContentPreview(row.fullPath),supplementalPdfData(row,stat)]);
      if(pdfData?.text)data={...pdfData,source:'pdfjs-acroform'};else if(everythingText?.text)data={...everythingText,source:'everything-content'};
    }else{const extracted=await readEverythingContentPreview(row.fullPath);if(extracted)data={...extracted,source:'everything-content'}}
    return data;
  }
  function searchablePreviewText(row,stat){
    const extension=documentExtension(row.fullPath),fingerprint=`${Number(stat.size)||0}:${Number(stat.mtimeMs)||0}${extension==='pdf'?`:pdf-search-${PDF_FORM_SEARCH_TEXT_REVISION}:geometry-${PDF_FORM_GEOMETRY_REVISION}`:''}`;
    return previewTextCache.read(row.fullPath,fingerprint,()=>loadSearchablePreviewText(row,stat));
  }
  async function previewMatches(id){
    const {row,stat}=await resolveResult(id),query=normalizeSearchText(row.query);
    if(row.mode!=='content'||query.length<2||stat.isDirectory())return {ok:true,bridgeVersion:BRIDGE_VERSION,active:false,query:'',count:0,snippets:[]};
    const started=Date.now(),content=await searchablePreviewText(row,stat);
    if(!content?.text)return {
      ok:true,
      bridgeVersion:BRIDGE_VERSION,
      active:true,
      query,
      count:0,
      snippets:[],
      truncated:false,
      source:'unavailable',
      elapsedMs:Date.now()-started
    };
    const extension=documentExtension(row.fullPath);
    const search=normalizeContentSearchOptions(row.contentSearch),matches=extension==='pdf'?buildContentMatchInfo(content.text,query,{...search,contextChars:96,maxSnippets:500,maxMatches:500}):buildContentMatchInfo(content.text,query,search);
    const canBuildFormAnchors=extension==='pdf'&&Array.isArray(content.formFields),formMatchInfo=canBuildFormAnchors?buildPdfFormMatchAnchors(content.formFields,query,search,5000):{anchors:[],capped:false},formAnchorsAuthoritative=formMatchInfo.anchors.length>0;
    await appendLog(`PREVIEW_MATCHES count=${matches.count} snippets=${matches.snippets.length} formAnchors=${formMatchInfo.anchors.length} authoritative=${formAnchorsAuthoritative} source=${content.source} elapsedMs=${Date.now()-started} path=${JSON.stringify(row.fullPath)}`);
    return {
      ok:true,
      bridgeVersion:BRIDGE_VERSION,
      active:true,
      ...matches,
      formAnchors:formMatchInfo.anchors,
      formAnchorsCapped:formMatchInfo.capped,
      formAnchorsAuthoritative,
      truncated:!!content.truncated,
      source:content.source,
      elapsedMs:Date.now()-started
    };
  }
  function previewMetadata(row,stat){
    const extension=documentExtension(row.fullPath);
    return {
      name:path.win32.basename(row.fullPath),
      path:path.win32.dirname(row.fullPath),
      fullPath:row.fullPath,
      extension,
      size:Number(stat.size)||0,
      isDirectory:stat.isDirectory(),
      modified:stat.mtime?.toISOString?.()||''
    }
  }
  const documentPreview=createDocumentPreview({
    resolve:async id=>{
      const {row,stat}=await resolveResult(id),metadata=previewMetadata(row,stat);
      return {
        mode:row.mode,
        metadata,
        officeKind:officePreviewKind(metadata.extension)||'',
        structuredKind:structuredPreviewKind(metadata.extension)||'',
      }
    },
    files:previewFiles,
    indexedText:readEverythingContentPreview,
  });
  const previewDocument=documentPreview.document,readBinaryPreview=documentPreview.file;
  async function openDocument(id){
    const {row,stat}=await resolveResult(id);
    if(process.platform!=='win32'){const e=new Error('פתיחת קובץ נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
    const env={...process.env,NETUNIM_OPEN_TARGET:row.fullPath};
  // Use the Windows graphical shell for both folders and documents. Unlike
  // Shell.Application.Open, ProcessStartInfo+UseShellExecute invokes the
  // registered default "open" action for a directory/document in the user's
  // interactive shell and does not wait for explorer.exe to exit.
    const script='$p=$env:NETUNIM_OPEN_TARGET; $psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName=$p; $psi.UseShellExecute=$true; [void][System.Diagnostics.Process]::Start($psi)';
    await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:7000,env});
    await appendLog(`OPEN type=${stat.isDirectory()?'folder':'file'} shell=UseShellExecute path=${JSON.stringify(row.fullPath)}`);
    return {ok:true,type:stat.isDirectory()?'folder':'file'};
  }
  async function revealDocument(id){
    const {row,stat}=await resolveResult(id);
    if(process.platform!=='win32'){const e=new Error('פתיחת מיקום נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
    const env={...process.env,NETUNIM_REVEAL_TARGET:row.fullPath};
    const script=`$p=$env:NETUNIM_REVEAL_TARGET; $psi=New-Object System.Diagnostics.ProcessStartInfo; $psi.FileName='explorer.exe'; $psi.Arguments=('/select,"{0}"' -f $p); $psi.UseShellExecute=$true; [void][System.Diagnostics.Process]::Start($psi)`;
    await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:7000,env});
    await appendLog(`REVEAL type=${stat.isDirectory()?'folder':'file'} shell=ExplorerSelect path=${JSON.stringify(row.fullPath)}`);
    return {ok:true,type:stat.isDirectory()?'folder':'file'};
  }
  async function invalidateResultPath(fullPath){
    const target=String(fullPath||'').toLocaleLowerCase('en-US'),invalidatedIds=documentResults.invalidate(fullPath);
    previewTextCache.invalidate(target);
    await pdfPreviewOperation.invalidate(fullPath);
    await pdfIndexRuntime.remove(fullPath);
    return invalidatedIds;
  }
  async function deleteDocument(id){
    const {row,stat}=await resolveResult(id);
    if(process.platform!=='win32'){const e=new Error('מחיקת קובץ נתמכת רק ב-Windows.');e.code='WINDOWS_REQUIRED';throw e}
    await hideNativePreview();
    const env={...process.env,NETUNIM_DELETE_TARGET:row.fullPath};
    const script='Add-Type -AssemblyName Microsoft.VisualBasic; $p=$env:NETUNIM_DELETE_TARGET; $ui=[Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs; $recycle=[Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin; $cancel=[Microsoft.VisualBasic.FileIO.UICancelOption]::ThrowException; if([System.IO.Directory]::Exists($p)){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,$ui,$recycle,$cancel)}elseif([System.IO.File]::Exists($p)){[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,$ui,$recycle,$cancel)}else{throw "Target no longer exists."}';
    await execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:30000,env});
    let missing=false;
    try{await fs.stat(row.fullPath)}catch(error){if(error?.code==='ENOENT')missing=true;else throw error}
    if(!missing){const e=new Error('Windows לא אישר שהקובץ נמחק.');e.code='DELETE_TARGET_REMAINS';throw e}
    const invalidatedIds=await invalidateResultPath(row.fullPath);
    await appendLog(`DELETE type=${stat.isDirectory()?'folder':'file'} recycle=SendToRecycleBin invalidated=${invalidatedIds.length} path=${JSON.stringify(row.fullPath)}`);
    return {ok:true,type:stat.isDirectory()?'folder':'file',invalidatedIds};
  }
  return {
    search:{selectFolder:own(selectSearchFolder)},
    preview:{document:own(previewDocument),matches:own(previewMatches),file:own(readBinaryPreview)},
    native:{open:own(openNativePreview),move:own(moveNativePreview),hide:own(hideNativePreview)},
    files:{open:own(openDocument),reveal:own(revealDocument),delete:own(deleteDocument)},
    runtime,
  };
}
