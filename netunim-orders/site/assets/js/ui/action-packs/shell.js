

export function createShellActions({uiModal}){
const dismissModal=(...args)=>uiModal.dismissModal(...args);
const actions={
  'select-input':(element,event)=>{element.select()},
  'close-modal':(element,event)=>{dismissModal()},
  'blur-on-enter':(element,event)=>{if(event.key==='Enter')element.blur()},
};
return actions;
}
