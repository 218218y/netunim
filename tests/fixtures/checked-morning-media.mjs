import {createMorningDocumentMedia,decodeMorningDraftPdf,decodeMorningVerifiedDocumentId} from '../../netunim-orders/site/assets/js/domains/customers/morning-document-media.js';
/** @type {Parameters<typeof createMorningDocumentMedia>[0]} */
const ports={request:{json:async()=>null,pdf:async()=>new Blob()},authority:{capture:()=>()=>{}},presentation:{capture:()=>({isCurrent:()=>true,show:()=>({src:'',removeAttribute(){}})})},platform:{createUrl:()=> 'blob:fixture',revokeUrl(){},watch:()=>()=>{}},feedback:{toast(){}}};
const media=createMorningDocumentMedia(ports);
/** @type {Promise<boolean>} */ const completed=media.viewDocument('historical-document-id');void completed;
/** @type {Promise<void>} */ const draining=media.drain();void draining;
/** @type {Blob} */ const decoded=decodeMorningDraftPdf(null);void decoded;
/** @type {string} */ const verified=decodeMorningVerifiedDocumentId(null);void verified;
// @ts-expect-error A media request cannot treat unvalidated JSON as a Blob.
createMorningDocumentMedia({...ports,request:{...ports.request,pdf:async()=>({type:'application/pdf'})}});
// @ts-expect-error Surface identity must be checked synchronously, before URL publication.
createMorningDocumentMedia({...ports,presentation:{capture:()=>({isCurrent:async()=>true,show:()=>null})}});
// @ts-expect-error Authentication assertions must finish before provider effects.
createMorningDocumentMedia({...ports,authority:{capture:()=>async()=>{}}});
// @ts-expect-error Text labels cannot authorize current display publication.
media.viewDocument('document',{isCurrent:()=> 'current'});
// @ts-expect-error The source is a stable document ID, not a guessed numeric index.
media.viewDocument(7);
// @ts-expect-error Callers cannot access the private active Blob URL or ticket.
media.previewObjectUrl;
// @ts-expect-error Draft commands require an object payload.
media.previewDraft('invoice');
