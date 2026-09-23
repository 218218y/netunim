// Mobile-sidebar ownership lives here so the composition root only wires navigation.
export function createUiSidebar({setPage}){
  const sidebar=document.getElementById('sidebar');
  const backdrop=document.getElementById('sidebarBackdrop');
  const menu=document.getElementById('mobileMenu');
  const nav=document.getElementById('nav');
  const media=window.matchMedia('(max-width: 820px)');
  let bound=false;

  function setOpen(open,{restoreFocus=false}={}){
    const expanded=media.matches&&!!open;
    sidebar.classList.toggle('open',expanded);
    backdrop.classList.toggle('open',expanded);
    document.body.classList.toggle('sidebar-open',expanded);
    menu.setAttribute('aria-expanded',String(expanded));
    menu.setAttribute('aria-label',expanded?'סגור תפריט':'פתח תפריט');
    sidebar.setAttribute('aria-hidden',String(media.matches&&!expanded));
    backdrop.tabIndex=expanded?0:-1;
    if(expanded)requestAnimationFrame(()=>sidebar.querySelector('.nav button.active')?.focus());
    else if(restoreFocus)menu.focus();
  }

  function syncMode(){
    if(media.matches)setOpen(sidebar.classList.contains('open'));
    else setOpen(false);
  }

  function bind(){
    if(bound)return;
    bound=true;
    nav.addEventListener('click',event=>{
      const button=event.target.closest('button[data-page]');
      if(!button)return;
      setPage(button.dataset.page);
      setOpen(false);
    });
    menu.addEventListener('click',()=>setOpen(!sidebar.classList.contains('open'),{restoreFocus:sidebar.classList.contains('open')}));
    backdrop.addEventListener('click',()=>setOpen(false,{restoreFocus:true}));
    media.addEventListener('change',syncMode);
    syncMode();
  }

  return {
    bind,
    isOpen:()=>sidebar.classList.contains('open'),
    close:options=>setOpen(false,options),
  };
}
