const MATCH_MODES=new Set(['phrase','all','any','proximity']);
const WORD_MATCHES=new Set(['partial','whole']);
const MODE_LABELS=Object.freeze({phrase:'ביטוי מדויק',all:'כל המילים',any:'מילה כלשהי',proximity:'קרבה לפי הסדר'});
const WORD_LABELS=Object.freeze({partial:'חלק',whole:'שלם'});

export function createDocumentContentSearchOptions({refs,isEnabled,onChanged}){
  let matchMode='phrase',wordMatch='partial',proximityWords=10,menuOpen=false;
  const normalized=()=>({matchMode:MATCH_MODES.has(matchMode)?matchMode:'phrase',wordMatch:WORD_MATCHES.has(wordMatch)?wordMatch:'partial',proximityWords:Math.max(0,Math.min(50,Math.trunc(Number(proximityWords)||0)))});

  function placeMenu(){
    const {contentOptionsButton:button,contentOptionsMenu:menu}=refs();if(!button||!menu||menu.hidden)return;
    const rect=button.getBoundingClientRect(),viewportWidth=Math.max(320,globalThis.innerWidth||document.documentElement?.clientWidth||320),viewportHeight=Math.max(320,globalThis.innerHeight||document.documentElement?.clientHeight||320),margin=8,width=Math.min(370,viewportWidth-margin*2);
    menu.style.width=`${width}px`;const height=Math.max(0,menu.offsetHeight||0),left=Math.max(margin,Math.min(viewportWidth-width-margin,rect.right-width));let top=rect.bottom+6;if(height&&top+height>viewportHeight-margin)top=Math.max(margin,rect.top-height-6);menu.style.left=`${Math.round(left)}px`;menu.style.top=`${Math.round(top)}px`;
  }
  function setMenu(open,{restoreFocus=false}={}){
    const {contentOptionsButton:button,contentOptionsMenu:menu}=refs(),enabled=!!isEnabled();menuOpen=!!open&&enabled;
    if(menu)menu.hidden=!menuOpen;if(button)button.setAttribute('aria-expanded',menuOpen?'true':'false');
    if(menuOpen)requestAnimationFrame(placeMenu);else if(restoreFocus)requestAnimationFrame(()=>button?.focus());
  }
  function update(){
    const {contentOptions,contentOptionsButton:button,contentModeLabel,contentWordLabel,contentModeButtons=[],contentWordButtons=[],proximityWrap,proximityWords:wordsControl}=refs(),search=normalized(),enabled=!!isEnabled();
    matchMode=search.matchMode;wordMatch=search.wordMatch;proximityWords=search.proximityWords;if(!enabled&&menuOpen)setMenu(false);
    if(button){button.disabled=!enabled;button.title=enabled?'אפשרויות התאמה בחיפוש תוכן':'אפשרויות התאמה זמינות בחיפוש התוכן המקומי של Everything בלבד.'}
    if(contentModeLabel)contentModeLabel.textContent=MODE_LABELS[search.matchMode]||MODE_LABELS.phrase;
    if(contentWordLabel)contentWordLabel.textContent=WORD_LABELS[search.wordMatch]||WORD_LABELS.partial;
    for(const control of contentModeButtons){const active=control.dataset.contentMatchMode===search.matchMode;control.classList.toggle('selected',active);control.setAttribute('aria-pressed',active?'true':'false');control.disabled=!enabled}
    for(const control of contentWordButtons){const active=control.dataset.contentWordMatch===search.wordMatch;control.classList.toggle('selected',active);control.setAttribute('aria-pressed',active?'true':'false');control.disabled=!enabled}
    if(wordsControl){wordsControl.value=String(search.proximityWords);wordsControl.disabled=!enabled}
    if(proximityWrap)proximityWrap.hidden=search.matchMode!=='proximity';
    contentOptions?.classList.toggle('is-disabled',!enabled);if(menuOpen)requestAnimationFrame(placeMenu);
  }

  function bind(){
    const {input,contentOptions,contentOptionsButton:button,contentOptionsMenu:menu,proximityWords:wordsControl}=refs();
    button?.addEventListener('click',event=>{event.preventDefault();setMenu(!menuOpen)});
    menu?.addEventListener('click',event=>{
      const modeControl=event.target.closest?.('[data-content-match-mode]');if(modeControl){const next=String(modeControl.dataset.contentMatchMode||'');if(MATCH_MODES.has(next)&&next!==matchMode){matchMode=next;update();onChanged?.()}return}
      const wordControl=event.target.closest?.('[data-content-word-match]');if(wordControl){const next=String(wordControl.dataset.contentWordMatch||'');if(WORD_MATCHES.has(next)&&next!==wordMatch){wordMatch=next;update();onChanged?.()}return}
    });
    wordsControl?.addEventListener('change',()=>{proximityWords=Math.max(0,Math.min(50,Math.trunc(Number(wordsControl.value)||0)));update();onChanged?.();requestAnimationFrame(()=>input?.focus())});
    document.addEventListener('pointerdown',event=>{if(menuOpen&&!contentOptions?.contains(event.target)&&!menu?.contains(event.target))setMenu(false)});
    document.addEventListener('keydown',event=>{if(menuOpen&&event.key==='Escape'){event.preventDefault();event.stopPropagation();setMenu(false,{restoreFocus:true})}},true);
    globalThis.addEventListener?.('resize',()=>{if(menuOpen)placeMenu()},{passive:true});
  }

  return {value:normalized,update,bind,close:()=>setMenu(false)};
}
