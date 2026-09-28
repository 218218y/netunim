const MATCH_MODES=new Set(['phrase','all','any','proximity']);

export function createDocumentContentSearchOptions({refs,isEnabled,onChanged}){
  let matchMode='phrase',proximityWords=10;
  const normalized=()=>({matchMode:MATCH_MODES.has(matchMode)?matchMode:'phrase',proximityWords:Math.max(0,Math.min(50,Math.trunc(Number(proximityWords)||0)))});

  function update(){
    const {contentOptions,contentMatchMode:modeControl,proximityWrap,proximityWords:wordsControl}=refs(),search=normalized(),enabled=!!isEnabled();
    matchMode=search.matchMode;proximityWords=search.proximityWords;
    if(modeControl){modeControl.value=search.matchMode;modeControl.disabled=!enabled;modeControl.title=enabled?'':'אפשרויות התאמה מתקדמות זמינות בחיפוש התוכן המקומי של Everything.'}
    if(wordsControl){wordsControl.value=String(search.proximityWords);wordsControl.disabled=!enabled}
    if(proximityWrap)proximityWrap.hidden=search.matchMode!=='proximity';
    contentOptions?.classList.toggle('is-disabled',!enabled);
  }

  function bind(){
    const {input,contentMatchMode:modeControl,proximityWords:wordsControl}=refs();
    modeControl?.addEventListener('change',()=>{matchMode=MATCH_MODES.has(modeControl.value)?modeControl.value:'phrase';update();onChanged?.();requestAnimationFrame(()=>input?.focus())});
    wordsControl?.addEventListener('change',()=>{proximityWords=Math.max(0,Math.min(50,Math.trunc(Number(wordsControl.value)||0)));update();onChanged?.();requestAnimationFrame(()=>input?.focus())});
  }

  return {value:normalized,update,bind};
}
