const FOLDER_MIME='application/vnd.google-apps.folder';
const SHORTCUT_MIME='application/vnd.google-apps.shortcut';
const GOOGLE_MIME_PREFIX='application/vnd.google-apps.';
const GOOGLE_DOCUMENT_MIME='application/vnd.google-apps.document';
const GOOGLE_SHEET_MIME='application/vnd.google-apps.spreadsheet';
const GOOGLE_PRESENTATION_MIME='application/vnd.google-apps.presentation';
const GOOGLE_DRAWING_MIME='application/vnd.google-apps.drawing';
const GOOGLE_SCRIPT_MIME='application/vnd.google-apps.script';
const PDF_MIME='application/pdf';
const XLSX_MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SCRIPT_JSON_MIME='application/vnd.google-apps.script+json';
const MAX_LIST_PAGES=10;
const MAX_PREVIEW_BYTES=64*1024*1024;
const MAX_TEXT_PREVIEW_BYTES=4*1024*1024;
const TEXT_EXTENSIONS=new Set(['txt','log','md','markdown','csv','tsv','json','xml','yaml','yml','ini','cfg','conf','sql','js','mjs','cjs','ts','tsx','jsx','css','scss','less','html','htm']);
const BINARY_PREVIEW_MIME=new Map([['pdf',PDF_MIME],['png','image/png'],['jpg','image/jpeg'],['jpeg','image/jpeg'],['gif','image/gif'],['webp','image/webp'],['bmp','image/bmp'],['svg','image/svg+xml']]);
const WORD_PREVIEW_MIME=new Map([['docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],['docm','application/vnd.ms-word.document.macroEnabled.12'],['dotx','application/vnd.openxmlformats-officedocument.wordprocessingml.template'],['dotm','application/vnd.ms-word.template.macroEnabled.12']]);
const SHEET_PREVIEW_MIME=new Map([['xls','application/vnd.ms-excel'],['xlsx',XLSX_MIME],['xlsm','application/vnd.ms-excel.sheet.macroEnabled.12'],['xlsb','application/vnd.ms-excel.sheet.binary.macroEnabled.12'],['xlt','application/vnd.ms-excel'],['xltx','application/vnd.openxmlformats-officedocument.spreadsheetml.template'],['xltm','application/vnd.ms-excel.template.macroEnabled.12']]);

const DOCUMENT_FILE_TYPES=new Set(['all','audio','documents','folders','images','video','pdf','word']);
const AUDIO_EXTENSIONS=new Set('aac;ac3;aif;aifc;aiff;amr;ape;au;cda;dts;fla;flac;it;m1a;m2a;m3u;m4a;m4b;m4p;mid;midi;mka;mod;mp2;mp3;mpa;mpc;ogg;opus;ra;rmi;snd;spc;voc;wav;weba;wma;xm'.split(';'));
const DOCUMENT_EXTENSIONS=new Set('c;cc;chm;cpp;cs;css;csv;cxx;doc;docm;docx;dot;dotm;dotx;epub;h;hpp;htm;html;hxx;ini;java;js;json;lua;md;mht;mhtml;mobi;odp;ods;odt;pdf;php;potx;potm;ppam;ppsm;ppsx;pps;ppt;pptm;pptx;pub;py;rtf;sldm;sldx;thmx;txt;vsd;wpd;wps;wri;xlam;xls;xlsb;xlsm;xlsx;xltm;xltx;xml;vb'.split(';'));
const IMAGE_EXTENSIONS=new Set('ani;apng;avci;avcs;avif;avifs;bmp;bpg;cur;gif;heic;heics;heif;heifs;hif;ico;jfi;jfif;jif;jpe;jpeg;jpg;pcx;png;psb;psd;rle;svg;tga;tif;tiff;webp;wmf'.split(';'));
const VIDEO_EXTENSIONS=new Set('3g2;3gp;3gp2;3gpp;amv;asf;asx;avi;bdmv;bik;d2v;divx;drc;dsa;dsm;dss;dsv;evo;f4v;flc;fli;flic;flv;hdmov;ifo;ivf;m1v;m2p;m2t;m2ts;m2v;m4v;mkv;mp2v;mp4;mp4v;mpe;mpeg;mpg;mpls;mpv2;mpv4;mov;mts;ogm;ogv;pss;pva;qt;ram;ratdvd;rm;rmm;rmvb;roq;rpm;smil;smk;swf;tp;tpr;ts;vob;vp6;webm;wm;wmp;wmv'.split(';'));
const WORD_EXTENSIONS=new Set(['doc','docx','docm','dot','dotx','dotm','rtf']);
function normalizeDocumentFileType(value){const key=String(value||'').trim().toLowerCase();return DOCUMENT_FILE_TYPES.has(key)?key:'all'}
function matchesDocumentFileType(row,fileType){
  const type=normalizeDocumentFileType(fileType);if(type==='all')return true;
  if(type==='folders')return !!row?.isDirectory;
  if(row?.isDirectory)return false;
  const extension=String(row?.extension||'').toLowerCase(),mime=String(row?.mimeType||'').toLowerCase();
  if(type==='audio')return mime.startsWith('audio/')||AUDIO_EXTENSIONS.has(extension);
  if(type==='images')return mime.startsWith('image/')||IMAGE_EXTENSIONS.has(extension);
  if(type==='video')return mime.startsWith('video/')||VIDEO_EXTENSIONS.has(extension);
  if(type==='pdf')return mime===PDF_MIME||extension==='pdf';
  if(type==='word')return WORD_EXTENSIONS.has(extension);
  if(type==='documents')return DOCUMENT_EXTENSIONS.has(extension)||(mime.startsWith(GOOGLE_MIME_PREFIX)&&mime!==FOLDER_MIME&&mime!==SHORTCUT_MIME);
  return true;
}

function driveError(message,code='GOOGLE_DRIVE_ERROR',extra={}){const error=new Error(message);error.code=code;error.status=Number(extra?.status)||0;error.payload=extra?.payload||null;return error}
function escapeQueryLiteral(value){return String(value||'').replaceAll('\\','\\\\').replaceAll("'","\\'")}
function queryTerms(value){return String(value||'').trim().split(/\s+/).map(x=>x.trim()).filter(Boolean).slice(0,12)}
export function buildGoogleDriveQuery(value,mode='everything'){
  const terms=queryTerms(value),content=mode==='content',field=content?'fullText':'name',clauses=['trashed = false'];
  if(content)clauses.push(`mimeType != '${FOLDER_MIME}'`);
  clauses.push(...terms.map(term=>`${field} contains '${escapeQueryLiteral(term)}'`));
  return clauses.join(' and ');
}
function extensionOf(file){const direct=String(file?.fileExtension||'').trim().toLowerCase();if(direct)return direct;const name=String(file?.name||''),match=name.match(/\.([^.\\/]+)$/);return match?match[1].toLowerCase():''}
export function safeGoogleDriveViewUrl(value){try{const url=new URL(String(value||''));const host=url.hostname.toLowerCase();if(url.protocol!=='https:'||!(host==='google.com'||host.endsWith('.google.com')))return '';return url.toString()}catch{return ''}}
function normalizeFile(file){const mimeType=String(file?.mimeType||''),isDirectory=mimeType===FOLDER_MIME,size=Number(file?.size),shortcut=file?.shortcutDetails||{};return {id:String(file?.id||''),name:String(file?.name||''),fullPath:'Google Drive',relativePath:'Google Drive',modified:String(file?.modifiedTime||''),size:Number.isFinite(size)?size:null,extension:isDirectory?'':extensionOf(file),attributes:'',isDirectory,rootId:'google-drive',rootLabel:'Google Drive',mimeType,webViewLink:safeGoogleDriveViewUrl(file?.webViewLink),resourceKey:String(file?.resourceKey||''),canDownload:file?.capabilities?.canDownload!==false,shortcutTargetId:String(shortcut?.targetId||''),shortcutTargetMimeType:String(shortcut?.targetMimeType||''),shortcutTargetResourceKey:String(shortcut?.targetResourceKey||'')}}
const DOCUMENT_SORT_FIELDS=new Set(['name','path','size','modified']);
function normalizeDocumentSort(sort={}){const field=DOCUMENT_SORT_FIELDS.has(String(sort?.field||'').toLowerCase())?String(sort.field).toLowerCase():'modified',fallback=(field==='size'||field==='modified')?'desc':'asc',direction=String(sort?.direction||'').toLowerCase();return {field,direction:direction==='asc'||direction==='desc'?direction:fallback}}
function compareDocumentRows(a,b,sort={}){const normalized=normalizeDocumentSort(sort),factor=normalized.direction==='desc'?-1:1;let result=0;if(normalized.field==='size'){const left=Number(a?.size),right=Number(b?.size);result=(Number.isFinite(left)?left:-1)-(Number.isFinite(right)?right:-1)}else if(normalized.field==='modified'){const left=Date.parse(a?.modified||''),right=Date.parse(b?.modified||'');result=(Number.isFinite(left)?left:0)-(Number.isFinite(right)?right:0)}else{const left=normalized.field==='path'?String(a?.relativePath||''):String(a?.name||''),right=normalized.field==='path'?String(b?.relativePath||''):String(b?.name||'');result=left.localeCompare(right,'he',{numeric:true,sensitivity:'base'})}if(result)return result*factor;return String(a?.name||'').localeCompare(String(b?.name||''),'he',{numeric:true,sensitivity:'base'})*factor}
function driveOrderBy(sort={}){const normalized=normalizeDocumentSort(sort),suffix=normalized.direction==='desc'?' desc':'';if(normalized.field==='name')return `name_natural${suffix}`;if(normalized.field==='modified')return `modifiedTime${suffix}`;return ''}
function params(query={}){const search=new URLSearchParams();for(const [key,value] of Object.entries(query)){if(value===undefined||value===null||value==='')continue;search.set(key,String(value))}return search.toString()}
function isGoogleWorkspaceMime(mime){return String(mime||'').startsWith(GOOGLE_MIME_PREFIX)}
function resourceKeyHeader(id,key){const fileId=String(id||''),resourceKey=String(key||'');return fileId&&resourceKey?`${fileId}/${resourceKey}`:''}
function previewDescriptor(row){
  if(row.isDirectory)return {kind:'folder'};
  if(!row.canDownload)return {kind:'cloud',reason:'download-restricted'};
  const mime=String(row.mimeType||''),extension=String(row.extension||'').toLowerCase();
  if(mime===GOOGLE_DOCUMENT_MIME||mime===GOOGLE_PRESENTATION_MIME||mime===GOOGLE_DRAWING_MIME)return {kind:'binary',mime:PDF_MIME,extension:'pdf',exportMime:PDF_MIME};
  if(mime===GOOGLE_SHEET_MIME)return {kind:'structured',documentKind:'spreadsheet',mime:XLSX_MIME,extension:'xlsx',exportMime:XLSX_MIME};
  if(mime===GOOGLE_SCRIPT_MIME)return {kind:'text',mime:SCRIPT_JSON_MIME,extension:'json',exportMime:SCRIPT_JSON_MIME};
  if(isGoogleWorkspaceMime(mime))return {kind:'cloud',reason:'workspace-type-not-previewable'};
  if(BINARY_PREVIEW_MIME.has(extension))return {kind:'binary',mime:BINARY_PREVIEW_MIME.get(extension),extension};
  if(WORD_PREVIEW_MIME.has(extension))return {kind:'structured',documentKind:'word',mime:WORD_PREVIEW_MIME.get(extension),extension};
  if(SHEET_PREVIEW_MIME.has(extension))return {kind:'structured',documentKind:'spreadsheet',mime:SHEET_PREVIEW_MIME.get(extension),extension};
  if(TEXT_EXTENSIONS.has(extension)||/^text\//i.test(mime)||['application/json','application/xml'].includes(mime))return {kind:'text',mime:mime||'text/plain',extension:extension||'txt'};
  return {kind:'cloud',reason:'unsupported-preview-type'};
}

export function isAndroidDocumentSearch(userAgent=''){return /\bAndroid\b/i.test(String(userAgent||''))}


export {SHORTCUT_MIME, MAX_LIST_PAGES, MAX_PREVIEW_BYTES, MAX_TEXT_PREVIEW_BYTES, normalizeDocumentFileType, matchesDocumentFileType, driveError, normalizeFile, normalizeDocumentSort, compareDocumentRows, driveOrderBy, params, resourceKeyHeader, previewDescriptor};
