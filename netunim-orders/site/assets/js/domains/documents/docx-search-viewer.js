import {createDomSearchNavigator} from './document-search-navigator.js';

const JSZIP_SRC=new URL('../../../vendor/document-viewers/jszip/jszip.min.js',import.meta.url).href;
const DOCX_SRC=new URL('../../../vendor/document-viewers/docx-preview/docx-preview.min.js',import.meta.url).href;
const scriptLoads=new Map();

function loadScript(src,ready){
  if(ready())return Promise.resolve();if(scriptLoads.has(src))return scriptLoads.get(src);
  const promise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.async=true;script.dataset.netunimDocumentRuntime='1';script.onload=()=>ready()?resolve():reject(new Error(`Runtime loaded without expected API: ${src}`));script.onerror=()=>reject(new Error(`Local document runtime is missing: ${src}`));document.head.append(script)}).catch(error=>{scriptLoads.delete(src);throw error});scriptLoads.set(src,promise);return promise;
}
async function loadRuntime(){await loadScript(JSZIP_SRC,()=>typeof globalThis.JSZip==='function');await loadScript(DOCX_SRC,()=>typeof globalThis.docx?.renderAsync==='function');return globalThis.docx}
function hardenRenderedDocument(root){
  root.querySelectorAll('script,iframe,object,embed,form,video,audio').forEach(node=>node.remove());
  root.querySelectorAll('a').forEach(anchor=>{anchor.removeAttribute('target');anchor.removeAttribute('ping');anchor.addEventListener('click',event=>event.preventDefault())});
  root.querySelectorAll('[src]').forEach(node=>{const value=String(node.getAttribute('src')||'');if(/^https?:/i.test(value))node.removeAttribute('src')});
}
export function preloadDocxSearchRuntime(){return loadRuntime()}
export async function createDocxSearchViewer({host,blob,query,onMatchState=()=>{}}){
  if(!host||!blob)throw new TypeError('DOCX preview host and blob are required');const runtime=await loadRuntime();host.innerHTML='';
  const viewport=document.createElement('div');viewport.className='document-docx-search-viewer';const body=document.createElement('div');body.className='document-docx-rendered';viewport.append(body);host.append(viewport);
  const bytes=await blob.arrayBuffer();
  await runtime.renderAsync(bytes,body,body,{className:'netunim-docx',inWrapper:true,ignoreWidth:false,ignoreHeight:false,ignoreFonts:false,breakPages:true,ignoreLastRenderedPageBreak:false,experimental:false,trimXmlDeclaration:true,useBase64URL:true,useMathMLPolyfill:false,renderHeaders:true,renderFooters:true,renderFootnotes:true,renderEndnotes:true,renderAltChunks:false,debug:false});
  hardenRenderedDocument(body);
  const navigator=createDomSearchNavigator({root:body,scrollContainer:viewport,query,onMatchState});
  return {...navigator,resize:()=>navigator.resize?.(),destroy:async()=>{await navigator.destroy();host.innerHTML=''}};
}
