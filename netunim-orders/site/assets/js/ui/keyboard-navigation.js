const NAV_SHORTCUTS=[
  ['Digit1','1','supplier'],
  ['Digit2','2','customers'],
  ['Digit3','3','customer-orders'],
  ['Digit4','4','warehouse'],
  ['Digit5','5','service'],
  ['Digit6','6','kupa'],
  ['Digit7','7','notes'],
  ['Digit8','8','calendar'],
];

const SHORTCUT_BY_CODE=new Map(NAV_SHORTCUTS.map(([code,number,view])=>[code,{number,view}]));
const SHORTCUT_BY_KEY=new Map(NAV_SHORTCUTS.map(([,number,view])=>[number,{number,view}]));

function editableTarget(target){
  if(!(target instanceof Element))return false;
  return !!target.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
}

function overlayOpen(){
  return !!(
    document.querySelector('.modal-backdrop.open')||
    document.querySelector('.confirm-backdrop.open')||
    document.querySelector('.global-search-backdrop:not([hidden])')
  );
}

function plainAltEvent(event){return !event.ctrlKey&&!event.metaKey&&!event.shiftKey}

// Top-level view keyboard navigation is intentionally centralized here so every
// shortcut uses the exact same navigation path as clicking a primary tab.
export function createUiKeyboardNavigation({switchView}){
  let keyTipsActive=false,altCandidate=false,altChordUsed=false,bound=false;
  const nav=()=>document.getElementById('nav');


  function shortcutButton(view){return nav()?.querySelector(`[data-view="${view}"]`)||null}

  function syncKeyTips(){nav()?.classList.toggle('keytips-active',keyTipsActive)}

  function closeKeyTips(){
    if(!keyTipsActive)return false;
    keyTipsActive=false;
    syncKeyTips();
    return true;
  }

  function openKeyTips(){
    if(keyTipsActive||overlayOpen())return false;
    keyTipsActive=true;
    syncKeyTips();
    return true;
  }

  function toggleKeyTips(){return keyTipsActive?closeKeyTips():openKeyTips()}

  function activateShortcut(shortcut){
    if(!shortcut||overlayOpen())return false;
    const button=shortcutButton(shortcut.view);
    if(!button)return false;
    const active=document.activeElement;
    if(editableTarget(active)&&typeof active.blur==='function')active.blur();
    closeKeyTips();
    switchView(shortcut.view);
    return true;
  }

  function annotateTabs(){
    for(const [,number,view] of NAV_SHORTCUTS){
      const button=shortcutButton(view);
      if(!button)continue;
      button.dataset.navKeytip=number;
      button.setAttribute('aria-keyshortcuts',`Alt+${number}`);
    }
  }

  function onKeyDown(event){
    if(event.key==='Alt'){
      if(!plainAltEvent(event)||event.repeat||overlayOpen()){
        altCandidate=false;
        return;
      }
      altCandidate=true;
      altChordUsed=false;
      event.preventDefault();
      return;
    }

    if(event.altKey)altChordUsed=true;

    const direct=event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey?(SHORTCUT_BY_CODE.get(event.code)||SHORTCUT_BY_KEY.get(event.key)):null;
    if(direct){
      altCandidate=false;
      altChordUsed=true;
      if(activateShortcut(direct))event.preventDefault();
      return;
    }

    if(!keyTipsActive)return;
    if(event.key==='Escape'){
      event.preventDefault();
      closeKeyTips();
      return;
    }
    if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||overlayOpen())return;
    const shortcut=SHORTCUT_BY_CODE.get(event.code)||SHORTCUT_BY_KEY.get(event.key);
    if(shortcut&&activateShortcut(shortcut))event.preventDefault();
  }

  function onKeyUp(event){
    if(event.key!=='Alt')return;
    const shouldToggle=altCandidate&&!altChordUsed&&plainAltEvent(event)&&!overlayOpen();
    altCandidate=false;
    altChordUsed=false;
    if(!shouldToggle)return;
    event.preventDefault();
    toggleKeyTips();
  }

  function onPointerDown(){
    altCandidate=false;
    altChordUsed=false;
    closeKeyTips();
  }

  function onBlur(){
    altCandidate=false;
    altChordUsed=false;
    closeKeyTips();
  }

  function onVisibilityChange(){if(document.hidden)onBlur()}

  function bind(){
    if(bound)return;
    bound=true;
    annotateTabs();
    document.addEventListener('keydown',onKeyDown,true);
    document.addEventListener('keyup',onKeyUp,true);
    document.addEventListener('pointerdown',onPointerDown,true);
    document.addEventListener('visibilitychange',onVisibilityChange);
    window.addEventListener('blur',onBlur);
  }

  return {bind,openKeyTips,closeKeyTips,toggleKeyTips,activateShortcut,isKeyTipsActive:()=>keyTipsActive,annotateTabs};
}

export {NAV_SHORTCUTS};
