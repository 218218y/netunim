// @ts-check
import {createRuntimeTaskOwner} from '../../shared/runtime-task-owner.js';
/** @typedef {import('../../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */
/** @typedef {'draft'|'official'} MediaKind */
/** @typedef {{src:string,removeAttribute:(name:string)=>void}} MediaFrame */
/** @typedef {{isCurrent:()=>boolean,show:(url:string)=>MediaFrame|null}} MediaSurface */
/** @typedef {{assertCurrent?:MorningAssertion,isCurrent?:()=>boolean,quiet?:boolean}} MediaOptions */
/** @typedef {{json:(action:string,payload:Record<string,unknown>,assertCurrent:MorningAssertion)=>Promise<unknown>,pdf:(id:string,assertCurrent:MorningAssertion)=>Promise<Blob>}} MediaRequest */
/** @typedef {{previewDraft:(payload:Record<string,unknown>,options?:MediaOptions)=>Promise<boolean>,viewDocument:(id:string,options?:MediaOptions)=>Promise<boolean>,viewVerifiedOperation:(operationId:string,options?:MediaOptions)=>Promise<boolean>,cancelPending:()=>void,dispose:()=>boolean,drain:()=>Promise<void>,isPending:()=>boolean}} MediaCapability */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function record(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/** @param {unknown} error */
function changed(error){return record(error)&&error.code==='MORNING_OPERATION_SCOPE_CHANGED'}
/** @param {unknown} error */
function message(error){return error instanceof Error?error.message:'טעינת מסמך Morning נכשלה'}

/** @param {unknown} value @returns {Blob} */
export function decodeMorningDraftPdf(value){
  if(!record(value)||typeof value.pdfBase64!=='string'||!value.pdfBase64)throw new Error('Morning לא החזירה קובץ תצוגה מקדימה');
  const binary=atob(value.pdfBase64);
  if(!binary.startsWith('%PDF-'))throw new Error('Morning החזירה תצוגה מקדימה שאינה PDF');
  const bytes=new Uint8Array(binary.length);for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
  return new Blob([bytes],{type:'application/pdf'});
}

/** @param {unknown} value @returns {string} */
export function decodeMorningVerifiedDocumentId(value){
  const row=record(value)&&record(value.operation)?value.operation:null;
  if(!row||row.state!=='created'||typeof row.verified_at!=='string'||!Number.isFinite(Date.parse(row.verified_at))||typeof row.document_id!=='string'||!row.document_id.trim())throw new Error('לא נמצא מסמך Morning מאומת לתנועה זו');
  return row.document_id;
}

/**
 * Draft and official PDFs share one publication generation and one live Blob.
 * Cancelling publication retains accepted reads until drain; iframe load never
 * revokes the source needed by the browser's built-in PDF Download action.
 * @param {{request:MediaRequest,authority:{capture:()=>MorningAssertion},presentation:{capture:(kind:MediaKind)=>MediaSurface|null},platform:{createUrl:(blob:Blob)=>string,revokeUrl:(url:string)=>void,watch:(changed:()=>void)=>()=>void},feedback:{toast:(text:string)=>void}}} ports
 * @returns {MediaCapability}
 */
export function createMorningDocumentMedia({request,authority,presentation,platform,feedback}){
  const work=createRuntimeTaskOwner();let generation=0,url='';
  /** @type {MediaFrame|null} */ let frame=null;
  /** @type {MediaSurface|null} */ let surface=null;
  /** @type {(()=>void)|null} */ let unsubscribe=null;

  function release(){
    if(frame?.src===url)frame.removeAttribute('src');frame=null;
    if(url){platform.revokeUrl(url);url=''}
  }
  function cancelPending(){generation++;surface=null;release();unsubscribe?.();unsubscribe=null}
  function watch(){if(!unsubscribe)unsubscribe=platform.watch(()=>{if(surface&&!surface.isCurrent())cancelPending()})}
  /** @param {MediaKind} kind @param {(assertCurrent:MorningAssertion,current:()=>boolean)=>Promise<Blob|null>} load @param {MediaOptions} [options] @returns {Promise<boolean>} */
  function show(kind,load,{assertCurrent,isCurrent=()=>true,quiet=false}={}){
    if(!work.isActive())return Promise.resolve(false);
    /** @type {MediaSurface|null} */ let captured;
    try{assertCurrent??=authority.capture();assertCurrent();captured=presentation.capture(kind);if(!captured||!captured.isCurrent()||!isCurrent())return Promise.resolve(false)}
    catch(error){if(!quiet&&!changed(error))feedback.toast(message(error));return Promise.resolve(false)}
    const assertRequest=assertCurrent,ticket=++generation;surface=captured;watch();
    const current=()=>work.isActive()&&ticket===generation&&captured.isCurrent()&&isCurrent();
    return work.run(async()=>{
      try{
        const blob=await load(assertRequest,current);assertRequest();if(!blob||!current())return false;
        release();const candidate=platform.createUrl(blob);url=candidate;
        try{frame=captured.show(candidate)}catch(error){release();throw error}
        if(!frame){release();return false}return true;
      }catch(error){if(current()&&!quiet&&!changed(error))feedback.toast(message(error));return false}
    });
  }
  /** @param {Record<string,unknown>} payload @param {MediaOptions} [options] */
  function previewDraft(payload,options){return show('draft',async assertCurrent=>decodeMorningDraftPdf(await request.json('preview',payload,assertCurrent)),options)}
  /** @param {string} id @param {MediaOptions} [options] */
  function viewDocument(id,options){return show('official',assertCurrent=>request.pdf(id,assertCurrent),options)}
  /** @param {string} operationId @param {MediaOptions} [options] */
  function viewVerifiedOperation(operationId,options){
    return show('official',async(assertCurrent,current)=>{
      const data=await request.json('status',{operation_id:operationId},assertCurrent);assertCurrent();
      if(!current())return null;
      const id=decodeMorningVerifiedDocumentId(data);
      return request.pdf(id,assertCurrent);
    },options);
  }
  function dispose(){if(!work.close())return false;cancelPending();return true}
  return {previewDraft,viewDocument,viewVerifiedOperation,cancelPending,dispose,drain:work.drain,isPending:work.isPending};
}
