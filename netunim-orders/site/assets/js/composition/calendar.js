import {createCalendarStorage} from '../calendar/storage.js';
import {createCalendarAuth} from '../calendar/auth.js';
import {createCalendarApi} from '../calendar/api.js';
import {createCalendarJournal} from '../calendar/journal.js';
import {createCalendarDeliveryOwner} from '../platform/calendar-delivery-owner.js';
import {createCalendarCommitNotifications} from '../platform/calendar-commit-notifications.js';
import {createDomainsCalendarController} from '../domains/calendar/controller.js';
import {createCalendarActionPorts} from '../domains/calendar/action-ports.js';
import {createCalendarBrowserEffects} from '../platform/calendar-browser-effects.js';

// Infrastructure is created early; the controller is composed after the UI
// ports exist. The caller starts it only after the app's boot promise resolves.
export function createOrdersCalendarRuntime({calendarSession,supaFetch,accountScope,subscribeAccountScope}){
  if(!calendarSession||typeof calendarSession!=='object')throw new Error('calendar_session_required');
  if(typeof supaFetch!=='function')throw new Error('calendar_cloud_port_required');
  if(typeof subscribeAccountScope!=='function')throw new Error('calendar_account_observation_required');
  const commitNotifications=createCalendarCommitNotifications();
  const calendarStorage=createCalendarStorage({onLocalCommit:commitNotifications.notify});
  const calendarAuth=createCalendarAuth({calendarSession,supaFetch,accountScope});
  const calendarApi=createCalendarApi({calendarAuth});
  const calendarJournal=createCalendarJournal({calendarStorage,calendarApi,operationScope:calendarAuth,deliveryOwner:createCalendarDeliveryOwner()});
  const effects=createCalendarBrowserEffects();
  let controller=null,disposed=false;

  function createController({ui,tab,calendarUi,uiLayout,uiModal,uiStatus,uiCloud,uiDateEditor}){
    if(disposed)throw new Error('calendar_runtime_disposed');
    if(controller)throw new Error('calendar_controller_already_composed');
    controller=createDomainsCalendarController({
      ui,tab,calendarUi,calendarSession,effects,
      calendarStorage,calendarAuth,calendarApi,calendarJournal,subscribeAccountScope,subscribeCalendarCommits:commitNotifications.subscribe,
      mountViewLayout:(...args)=>uiLayout.mountViewLayout(...args),
      modal:(...args)=>uiModal.modal(...args),
      closeModal:(...args)=>uiModal.closeModal(...args),
      toast:(...args)=>uiStatus.toast(...args),
      requestCloudLogin:()=>uiCloud.loginModal('calendar'),
      confirmDialog:(...args)=>uiModal.confirmDialog(...args),
      dateEditorMarkup:(...args)=>uiDateEditor.dateEditorMarkup(...args),
      setDateValue:(...args)=>uiDateEditor.setDateValue(...args),
    });
    return controller;
  }

  function actionPorts(){
    if(!controller)throw new Error('calendar_controller_not_composed');
    return createCalendarActionPorts(controller);
  }

  function dispose(){if(disposed)return false;disposed=true;if(controller)controller.dispose();else effects.dispose();return true}
  return {createController,actionPorts,dispose,drain:()=>controller?controller.runtime.drain():effects.drain()};
}
