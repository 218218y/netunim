import {createLazyDeferredSearchUpdater} from '../../shared/search-scheduler.js';

// Cash owns these delegated UI actions and its local event ports.
export function createCashActions({domainsCashController,domainsCashEditor,domainsCashView,ui}){
const openCashModal=(...args)=>domainsCashEditor.openCashModal(...args);
const openRightModal=(...args)=>domainsCashEditor.openRightModal(...args);
const setCashSearch=(...args)=>domainsCashView.setCashSearch(...args);
const setRightsLastCalculatedDate=(...args)=>domainsCashController.setRightsLastCalculatedDate(...args);
const cashSearch=createLazyDeferredSearchUpdater(value=>{ui.cashSearchValue=value},setCashSearch);
return {
  'cash-search':(element,event)=>{cashSearch(element.value,element)},
  'open-cash-modal':(element,event)=>{openCashModal()},
  'open-cash-modal-2':(element,event)=>{openCashModal(element.dataset.clickArg0)},
  'open-right-modal':(element,event)=>{openRightModal()},
  'open-right-modal-2':(element,event)=>{openRightModal(element.dataset.clickArg0)},
  'set-rights-last-calculated-date':(element,event)=>{setRightsLastCalculatedDate(element.value)},
};
}
