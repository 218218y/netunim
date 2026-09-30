import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

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
async function loadPdfJs(){
  if(pdfJsPromise)return pdfJsPromise;
  installNodePdfJsCompatibility();
  pdfJsPromise=(async()=>{
    const originalWarn=console.warn;
    try{
      console.warn=(...args)=>{
        if(args.length===1&&String(args[0])==='Warning: Please use the `legacy` build in Node.js environments.')return;
        originalWarn(...args);
      };
      const pdfjs=await import('./pdfjs/build/pdf.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc=new URL('./pdfjs/build/pdf.worker.min.mjs',import.meta.url).href;
      return pdfjs;
    }finally{console.warn=originalWarn}
  })();
  return pdfJsPromise;
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

export async function extractInteractivePdfText(fullPath,{maxBytes=PDF_FORM_MAX_BYTES,timeoutMs=PDF_FORM_EXTRACT_TIMEOUT_MS}={}){
  const stat=await fs.stat(fullPath);
  if(!stat.isFile())return {hasForm:false,formFieldCount:0,text:'',formText:'',pageText:'',size:Number(stat.size)||0,skipped:'not-file'};
  if(stat.size>maxBytes)return {hasForm:false,formFieldCount:0,text:'',formText:'',pageText:'',size:Number(stat.size)||0,skipped:'too-large'};
  const data=new Uint8Array(await fs.readFile(fullPath));
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
  let document=null,timeoutHandle=null;
  const boundedTimeout=Math.max(1000,Math.min(60000,Number(timeoutMs)||PDF_FORM_EXTRACT_TIMEOUT_MS));
  const timeoutPromise=new Promise((_,reject)=>{timeoutHandle=setTimeout(()=>{const error=new Error(`Interactive PDF extraction timed out after ${boundedTimeout} ms`);error.code='PDF_FORM_EXTRACT_TIMEOUT';try{Promise.resolve(task.destroy()).catch(()=>{})}catch{}reject(error)},boundedTimeout);timeoutHandle.unref?.()});
  const withinTimeout=promise=>Promise.race([promise,timeoutPromise]);
  try{
    document=await withinTimeout(task.promise);
    const pages=[],annotations=[];
    for(let pageNumber=1;pageNumber<=document.numPages;pageNumber+=1){
      const page=await withinTimeout(document.getPage(pageNumber));
      const pageAnnotations=await withinTimeout(page.getAnnotations({intent:'display'}));
      pages.push(page);annotations.push(...pageAnnotations);
    }
    const formAnnotations=annotations.filter(annotation=>annotation&&!annotation.password&&['Tx','Ch'].includes(String(annotation.fieldType||'')));
    if(!formAnnotations.length)return {hasForm:false,formFieldCount:0,text:'',formText:'',pageText:'',size:Number(stat.size)||0,skipped:''};
    const formText=collectPdfFormValues(formAnnotations).join('\n');
    const pageParts=[];
    for(const page of pages){
      const logical=textContentToLogicalText(await withinTimeout(page.getTextContent({includeMarkedContent:false,disableNormalization:false})));
      if(logical)pageParts.push(logical);
    }
    const pageText=pageParts.join('\n\n').trim();
    const text=[pageText,formText].filter(Boolean).join('\n\n').trim();
    return {hasForm:true,formFieldCount:formAnnotations.length,text,formText,pageText,size:Number(stat.size)||0,skipped:''};
  }finally{
    if(timeoutHandle)clearTimeout(timeoutHandle);
    try{await task.destroy()}catch{}
  }
}
