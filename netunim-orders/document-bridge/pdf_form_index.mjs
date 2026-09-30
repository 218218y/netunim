import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {contentMatchRanges,normalizeContentSearchOptions,normalizeSearchText} from './lib.mjs';

export const PDF_FORM_MAX_BYTES=64*1024*1024;
export const PDF_FORM_EXTRACT_TIMEOUT_MS=12*1000;

function installNodePdfJsCompatibility(){
  if(typeof Promise.try!=='function')Object.defineProperty(Promise,'try',{configurable:true,writable:true,value:function(callback,...args){return new Promise(resolve=>resolve(callback(...args)))}});
  if(typeof Uint8Array.prototype.toHex!=='function')Object.defineProperty(Uint8Array.prototype,'toHex',{configurable:true,writable:true,value:function(){return Array.from(this,byte=>byte.toString(16).padStart(2,'0')).join('')}});
  if(typeof Math.sumPrecise!=='function')Object.defineProperty(Math,'sumPrecise',{configurable:true,writable:true,value:function(values){let total=0;for(const value of values)total+=Number(value)||0;return total}});
  if(typeof Map.prototype.getOrInsertComputed!=='function')Object.defineProperty(Map.prototype,'getOrInsertComputed',{configurable:true,writable:true,value:function(key,callback){if(this.has(key))return this.get(key);const value=callback(key);this.set(key,value);return value}});
}

export class LocalPdfBinaryDataFactory{
  constructor({cMapUrl=null,standardFontDataUrl=null,wasmUrl=null}={}){
    this.cMapUrl=cMapUrl;this.standardFontDataUrl=standardFontDataUrl;this.wasmUrl=wasmUrl;
  }
  async fetch({kind,filename}){
    if(!['cMapUrl','standardFontDataUrl','wasmUrl'].includes(String(kind||'')))throw new Error(`Unsupported PDF.js binary data kind: ${kind}`);
    const baseUrl=this[kind];
    if(!baseUrl)throw new Error(`Missing PDF.js ${kind} base URL`);
    const resourceUrl=new URL(String(filename||''),String(baseUrl));
    if(resourceUrl.protocol!=='file:')throw new Error(`Refusing non-local PDF.js binary data URL: ${resourceUrl.href}`);
    return new Uint8Array(await fs.readFile(fileURLToPath(resourceUrl)));
  }
}

let pdfJsPromise=null;
async function importNodePdfJs(){
  const moduleUrl=new URL('./pdfjs/legacy/build/pdf.mjs',import.meta.url),workerUrl=new URL('./pdfjs/legacy/build/pdf.worker.min.mjs',import.meta.url);
  try{await Promise.all([fs.access(moduleUrl),fs.access(workerUrl)])}catch(error){
    const runtimeError=new Error('The bundled PDF.js legacy runtime required by the Windows Document Bridge is missing. Reinstall the current Document Bridge runtime.');
    runtimeError.code='PDFJS_NODE_LEGACY_RUNTIME_MISSING';runtimeError.cause=error;throw runtimeError;
  }
  const pdfjs=await import(moduleUrl.href);
  if(typeof pdfjs?.getDocument!=='function'||!pdfjs?.GlobalWorkerOptions){
    const error=new Error('The bundled PDF.js legacy runtime does not expose the Node API surface required by the Document Bridge.');
    error.code='PDFJS_NODE_API_MISMATCH';throw error;
  }
  pdfjs.GlobalWorkerOptions.workerSrc=workerUrl.href;
  return pdfjs;
}
async function loadPdfJs(){
  if(pdfJsPromise)return pdfJsPromise;
  installNodePdfJsCompatibility();
  pdfJsPromise=importNodePdfJs().catch(error=>{pdfJsPromise=null;throw error});
  return pdfJsPromise;
}
async function verifyNodePdfJsIntegrity(){
  const manifestUrl=new URL('./pdfjs/_runtime-manifest.txt',import.meta.url);let source='';
  try{source=await fs.readFile(manifestUrl,'utf8')}catch(error){const runtimeError=new Error('The PDF.js runtime manifest required by the Windows Document Bridge is missing. Reinstall the current Document Bridge runtime.');runtimeError.code='PDFJS_NODE_MANIFEST_MISSING';runtimeError.cause=error;throw runtimeError}
  const metadata=new Map(),digests=new Map();
  for(const raw of source.split(/\r?\n/)){const line=raw.trim();if(!line)continue;const digestMatch=line.match(/^([0-9a-f]{64})  (.+)$/i);if(digestMatch){digests.set(digestMatch[2],digestMatch[1].toLowerCase());continue}const split=line.indexOf('=');if(split>0)metadata.set(line.slice(0,split),line.slice(split+1))}
  if(metadata.get('package')!=='pdfjs-dist'||!metadata.get('version')){const error=new Error('The bundled PDF.js runtime manifest is invalid.');error.code='PDFJS_NODE_MANIFEST_INVALID';throw error}
  for(const relative of ['legacy/build/pdf.mjs','legacy/build/pdf.worker.min.mjs']){const expected=digests.get(relative);if(!expected){const error=new Error(`The PDF.js runtime manifest does not contain ${relative}.`);error.code='PDFJS_NODE_MANIFEST_INVALID';throw error}const data=await fs.readFile(new URL(`./pdfjs/${relative}`,import.meta.url));const actual=createHash('sha256').update(data).digest('hex');if(actual!==expected){const error=new Error(`The bundled PDF.js Node runtime failed integrity verification: ${relative}.`);error.code='PDFJS_NODE_INTEGRITY_MISMATCH';throw error}}
  return metadata.get('version');
}
export async function verifyNodePdfJsRuntime(){
  const manifestVersion=await verifyNodePdfJsIntegrity(),pdfjs=await loadPdfJs(),version=String(pdfjs?.version||'');
  if(version&&version!==manifestVersion){const error=new Error(`PDF.js Node runtime version ${version} does not match manifest version ${manifestVersion}.`);error.code='PDFJS_NODE_VERSION_MISMATCH';throw error}
  return {ok:true,version:version||manifestVersion,build:String(pdfjs?.build||''),runtime:'legacy'};
}

function cleanPdfText(value){
  return String(value??'').replace(/\u0000/g,'').replace(/\r\n?/g,'\n').normalize('NFC').trim();
}

function annotationValues(annotation){
  const raw=annotation?.fieldValue;
  if(Array.isArray(raw))return raw;
  return raw===undefined||raw===null?[]:[raw];
}

export function collectPdfFormValues(annotations=[]){
  const values=[],seen=new Set();
  for(const annotation of annotations){
    if(!annotation||annotation.password||!['Tx','Ch'].includes(String(annotation.fieldType||'')))continue;
    for(const raw of annotationValues(annotation)){
      const value=cleanPdfText(raw);if(!value)continue;
      const key=value.toLocaleLowerCase('he-IL');if(seen.has(key))continue;
      seen.add(key);values.push(value);
    }
  }
  return values;
}

function normalizedPdfRect(rect){
  if(!Array.isArray(rect)||rect.length!==4)return null;
  const values=rect.map(Number);return values.every(Number.isFinite)?values:null;
}

export function collectPdfFormFields(annotations=[],pageNumber=1){
  const fields=[];
  for(const [annotationIndex,annotation] of annotations.entries()){
    if(!annotation||annotation.password||!['Tx','Ch'].includes(String(annotation.fieldType||'')))continue;
    const values=annotationValues(annotation).map(cleanPdfText).filter(Boolean),rect=normalizedPdfRect(annotation.rect);
    if(!values.length||!rect)continue;
    const id=String(annotation.id||'').trim(),fieldName=String(annotation.fieldName||'');
    fields.push({pageNumber:Math.max(1,Number(pageNumber)||1),annotationIndex,fieldKey:id?`id:${id}`:`field:${Math.max(1,Number(pageNumber)||1)}:${annotationIndex}:${fieldName}:${rect.join(',')}`,fieldName,fieldType:String(annotation.fieldType||''),rect,values,multiLine:!!annotation.multiLine});
  }
  return fields;
}

function formFieldSnippet(value,range,{contextChars=96}={}){
  const source=String(value||''),context=Math.max(24,Math.min(180,Number(contextChars)||96)),start=Math.max(0,range.index-context),end=Math.min(source.length,range.index+range.length+context),clean=part=>String(part??'').replace(/\s+/g,' ');
  return {before:clean(source.slice(start,range.index)).trimStart(),match:source.slice(range.index,range.index+range.length),after:clean(source.slice(range.index+range.length,end)).trimEnd(),leading:start>0,trailing:end<source.length};
}

export function buildPdfFormMatchAnchors(formFields=[],query,contentSearch={},maxMatches=5000){
  const needle=normalizeSearchText(query),search=normalizeContentSearchOptions(contentSearch),highlightSearch=search.matchMode==='all'?{...search,matchMode:'any'}:search,limit=Math.max(1,Math.min(20000,Number(maxMatches)||5000)),anchors=[];let capped=false;
  if(needle.length<2)return {anchors,capped:false};
  for(const field of formFields||[]){
    const rect=normalizedPdfRect(field?.rect),pageNumber=Math.max(1,Number(field?.pageNumber)||1),fieldKey=String(field?.fieldKey||''),values=Array.isArray(field?.values)?field.values:[field?.value];
    if(!rect||!fieldKey)continue;
    for(const raw of values){
      const value=cleanPdfText(raw);if(!value)continue;
      const remaining=limit-anchors.length;if(remaining<=0){capped=true;break}
      const found=contentMatchRanges(value,needle,{...highlightSearch,maxMatches:remaining});
      for(const range of found.ranges)anchors.push({kind:'form',pageNumber,pageIdx:pageNumber-1,annotationIndex:Math.max(0,Number(field.annotationIndex)||0),fieldKey,fieldName:String(field.fieldName||''),fieldType:String(field.fieldType||''),rect:[...rect],start:range.index,end:range.index+range.length,snippet:formFieldSnippet(value,range),value});
      capped=capped||found.capped;
      if(anchors.length>=limit){capped=true;break}
    }
    if(anchors.length>=limit)break;
  }
  anchors.sort((a,b)=>a.pageIdx-b.pageIdx||a.annotationIndex-b.annotationIndex||a.start-b.start);
  return {anchors,capped};
}

export function textContentToLogicalText(content){
  const parts=[];
  for(const item of content?.items||[]){
    if(typeof item?.str!=='string')continue;
    const value=item.str.replace(/\u0000/g,'').normalize('NFC');
    if(value)parts.push(value);
    if(item.hasEOL)parts.push('\n');else if(value)parts.push(' ');
  }
  return parts.join('').replace(/[ \t]+\n/g,'\n').replace(/\n[ \t]+/g,'\n').replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}

function abortError(){const error=new Error('Interactive PDF extraction aborted');error.name='AbortError';error.code='ABORT_ERR';return error}
function throwIfAborted(signal){if(signal?.aborted)throw abortError()}

export async function extractInteractivePdfText(fullPath,{maxBytes=PDF_FORM_MAX_BYTES,timeoutMs=PDF_FORM_EXTRACT_TIMEOUT_MS,signal=null,includePageText=true,onBytesRead=null}={}){
  throwIfAborted(signal);
  const stat=await fs.stat(fullPath);
  throwIfAborted(signal);
  if(!stat.isFile())return {hasForm:false,formFieldCount:0,text:'',formText:'',pageText:'',formFields:[],size:Number(stat.size)||0,skipped:'not-file'};
  if(stat.size>maxBytes)return {hasForm:false,formFieldCount:0,text:'',formText:'',pageText:'',formFields:[],size:Number(stat.size)||0,skipped:'too-large'};
  const data=new Uint8Array(await fs.readFile(fullPath,signal?{signal}:undefined));
  if(typeof onBytesRead==='function')onBytesRead(data.byteLength);
  throwIfAborted(signal);
  const pdfjs=await loadPdfJs();
  const task=pdfjs.getDocument({
    data,
    useWorkerFetch:false,
    isEvalSupported:false,
    disableFontFace:true,
    verbosity:pdfjs.VerbosityLevel?.ERRORS??0,
    BinaryDataFactory:LocalPdfBinaryDataFactory,
    cMapUrl:new URL('./pdfjs/cmaps/',import.meta.url).href,
    cMapPacked:true,
    standardFontDataUrl:new URL('./pdfjs/standard_fonts/',import.meta.url).href,
    wasmUrl:new URL('./pdfjs/wasm/',import.meta.url).href,
  });
  let document=null,timeoutHandle=null,abortReject=null;
  const boundedTimeout=Math.max(1000,Math.min(60000,Number(timeoutMs)||PDF_FORM_EXTRACT_TIMEOUT_MS));
  const timeoutPromise=new Promise((_,reject)=>{timeoutHandle=setTimeout(()=>{const error=new Error(`Interactive PDF extraction timed out after ${boundedTimeout} ms`);error.code='PDF_FORM_EXTRACT_TIMEOUT';try{Promise.resolve(task.destroy()).catch(()=>{})}catch{}reject(error)},boundedTimeout);timeoutHandle.unref?.()});
  const abortPromise=new Promise((_,reject)=>{abortReject=()=>{try{Promise.resolve(task.destroy()).catch(()=>{})}catch{}reject(abortError())};signal?.addEventListener?.('abort',abortReject,{once:true})});
  const withinBounds=promise=>Promise.race(signal?[promise,timeoutPromise,abortPromise]:[promise,timeoutPromise]);
  try{
    document=await withinBounds(task.promise);
    const pages=[],formFields=[];
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber+=1){
      throwIfAborted(signal);
      const page=await withinBounds(document.getPage(pageNumber));
      const pageAnnotations=await withinBounds(page.getAnnotations({intent:'display'}));
      if(includePageText)pages.push(page);formFields.push(...collectPdfFormFields(pageAnnotations,pageNumber));
    }
    if(!formFields.length)return {hasForm:false,formFieldCount:0,text:'',formText:'',pageText:'',formFields:[],size:Number(stat.size)||0,skipped:''};
    const formText=collectPdfFormValues(formFields.map(field=>({fieldType:field.fieldType,fieldValue:field.values}))).join('\n');
    const pageParts=[];
    for(const page of pages){
      throwIfAborted(signal);
      const logical=textContentToLogicalText(await withinBounds(page.getTextContent({includeMarkedContent:false,disableNormalization:false})));
      if(logical)pageParts.push(logical);
    }
    const pageText=pageParts.join('\n\n').trim();
    const text=[pageText,formText].filter(Boolean).join('\n\n').trim();
    return {hasForm:true,formFieldCount:formFields.length,text,formText,pageText,formFields,size:Number(stat.size)||0,skipped:''};
  }finally{
    if(timeoutHandle)clearTimeout(timeoutHandle);
    if(abortReject)signal?.removeEventListener?.('abort',abortReject);
    try{await task.destroy()}catch{}
  }
}
