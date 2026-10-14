// @ts-check
/** @typedef {import('../domains/customers/morning-document-media.js').MediaSurface} MediaSurface */
/** @param {string} selector @returns {HTMLElement|null} */
function element(selector){return /** @type {HTMLElement|null} */ (document.querySelector(selector))}
/** @param {string} selector @returns {HTMLIFrameElement|null} */
function iframe(selector){return /** @type {HTMLIFrameElement|null} */ (document.querySelector(selector))}
/** @param {{modal:(title:string,body:string,foot:string)=>void,onStandalone:(surface:HTMLElement|null)=>void}} ports */
export function createMorningMediaPresentation({modal,onStandalone}){
  const modalOpen=()=>!element('#modalBackdrop')||element('#modalBackdrop')?.classList.contains('open')===true;
  /** @param {'draft'|'official'} kind @returns {MediaSurface|null} */
  function capture(kind){
    const panel=element('#modal');let marker=panel?.firstElementChild,open=modalOpen();
    const browser=open?element('#morningDocumentsBrowser'):null,issuance=open?element('#morningPreviewBox'):null;
    if(kind==='draft'&&(!issuance||!iframe('#morningPreviewFrame')))return null;
    const isCurrent=()=>element('#modal')===panel&&panel?.firstElementChild===marker&&modalOpen()===open
      &&(!browser||element('#morningDocumentsBrowser')===browser)&&(!issuance||element('#morningPreviewBox')===issuance);
    return {isCurrent,show(url){
      if(!isCurrent())return null;
      let box=kind==='draft'?issuance:(open?element('#morningBrowserPreview'):null)||issuance||(open?element('#morningStandalonePreview'):null);
      let frame=kind==='draft'?iframe('#morningPreviewFrame'):(open?iframe('#morningBrowserPreviewFrame'):null)||(open?iframe('#morningPreviewFrame'):null)||(open?iframe('#morningStandalonePreviewFrame'):null);
      if(kind==='official'&&(!box||!frame)){
        modal('צפייה במסמך Morning','<div id="morningStandalonePreview" class="morning-preview-box"><div class="morning-preview-head"><b>מסמך Morning</b><span>מסמך רשמי שנשלף מ-Morning ואינו נשמר באתר</span></div><iframe id="morningStandalonePreviewFrame" title="צפייה במסמך Morning"></iframe></div>','<button class="btn" data-action="close-modal">סגור</button>');
        box=element('#morningStandalonePreview');frame=iframe('#morningStandalonePreviewFrame');onStandalone(box);
        marker=panel?.firstElementChild;open=modalOpen();
      }
      if(!box||!frame)return null;
      const note=element('#morningPreviewNote');
      if(note&&!browser)note.textContent=kind==='draft'?'הקובץ עדיין לא הופק רשמית':'מסמך רשמי שנשלף מ-Morning ואינו נשמר באתר';
      frame.src=url;box.hidden=false;box.scrollIntoView({block:'nearest',behavior:'smooth'});return frame;
    }};
  }
  return {capture};
}
