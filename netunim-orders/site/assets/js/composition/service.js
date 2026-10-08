import {createDomainsServiceBulk} from '../domains/service/bulk.js';
import {createDomainsServiceView} from '../domains/service/view.js';
import {createDomainsServiceEditor} from '../domains/service/editor.js';
import {createServiceActionPorts} from '../domains/service/action-ports.js';
import {createServiceActions} from '../ui/action-packs/service.js';

// Service is a single journal domain. Keep its editors and delegated actions
// together instead of assembling them in the application shell.
export function createOrdersServiceRuntime({model,serviceUi,serviceRevision}={}){
  if(!model||!serviceUi||typeof serviceRevision!=='function')throw new TypeError('service_context_required');
  let bound=null;
  function ready(){
    if(!bound)throw new Error('service_ui_not_bound');
    return bound;
  }
  function renderService(...args){return ready().view.renderService(...args)}

  function bindUi({uiLayout,uiModal,uiStatus,storagePersistence,uiDateEditor}={}){
    if(bound)throw new Error('service_ui_already_bound');
    for(const [name,port,methods] of [
      ['layout',uiLayout,['mountViewLayout']],
      ['modal',uiModal,['modal','closeModal','confirmDialog']],
      ['status',uiStatus,['toast']],
      ['persistence',storagePersistence,['scheduleSave']],
      ['date',uiDateEditor,['dateEditorMarkup']],
    ])for(const method of methods)if(typeof port?.[method]!=='function')throw new TypeError(`service_${name}_${method}_required`);

    const scheduleSave=(message,options={})=>storagePersistence.scheduleSave(message,{...options,domains:['service']});
    const bulk=createDomainsServiceBulk({
      serviceUi,model,renderService,
      toast:(...args)=>uiStatus.toast(...args),scheduleSave,
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
    });
    const view=createDomainsServiceView({
      serviceRevision,model,serviceUi,
      mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
      serviceBulkControls:bulk.serviceBulkControls,
      syncServiceBulkUi:bulk.syncServiceBulkUi,
      toast:(...args)=>uiStatus.toast(...args),scheduleSave,
    });
    const editor=createDomainsServiceEditor({
      model,modal:(...args)=>uiModal.modal(...args),
      toast:(...args)=>uiStatus.toast(...args),scheduleSave,
      closeModal:(...args)=>uiModal.closeModal(...args),
      renderService,
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
    });
    const servicePorts=createServiceActionPorts({bulk,view,editor});
    const actions=createServiceActions({domainsServiceView:view,servicePorts,serviceUi});
    bound={view,actions};
  }

  return {
    bindUi,renderService,
    assertReady:()=>{ready();return true},
    get actions(){return ready().actions},
  };
}
