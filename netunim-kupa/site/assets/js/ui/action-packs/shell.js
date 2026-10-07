// Shell owns these delegated UI actions and its local event ports.
export function createShellActions({uiModal,uiNavigation}){
const closeModal=(...args)=>uiModal.closeModal(...args);
const setPage=(...args)=>uiNavigation.setPage(...args);
return {
  'select-input':(element,event)=>{element.select()},
  'set-page':(element,event)=>{setPage('bank')},
  'close-modal':(element,event)=>{closeModal()},
};
}
