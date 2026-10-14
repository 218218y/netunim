// @ts-check
/** Owns only native URL and modal observation effects; no document requests. */
export function createMorningMediaEffects(){
  return {
    /** @param {Blob} blob */ createUrl:blob=>URL.createObjectURL(blob),
    /** @param {string} url */ revokeUrl:url=>URL.revokeObjectURL(url),
    /** @param {()=>void} changed */
    watch(changed){
      if(typeof MutationObserver!=='function')return ()=>{};
      const observer=new MutationObserver(changed),panel=document.querySelector('#modal'),back=document.querySelector('#modalBackdrop');
      try{
        if(panel)observer.observe(panel,{childList:true});
        if(back)observer.observe(back,{attributes:true,attributeFilter:['class']});
      }catch(error){observer.disconnect();throw error}
      return ()=>observer.disconnect();
    },
  };
}
