import {createCalendarStorage} from '../calendar/storage.js';
import {createCalendarAuth} from '../calendar/auth.js';
import {createCalendarApi} from '../calendar/api.js';
import {createCalendarJournal} from '../calendar/journal.js';
import {createDomainsCalendarController} from '../domains/calendar/controller.js';
import {createCalendarActionPorts} from '../domains/calendar/action-ports.js';

// Infrastructure is created early; the controller is composed after the UI
// ports exist. The caller starts it only after the app's boot promise resolves.
export function createOrdersCalendarRuntime({calendarSession,supaFetch}){
  if(!calendarSession||typeof calendarSession!=='object')throw new Error('calendar_session_required');
  if(typeof supaFetch!=='function')throw new Error('calendar_cloud_port_required');
  const calendarStorage=createCalendarStorage();
  const calendarAuth=createCalendarAuth({calendarSession,supaFetch});
  const calendarApi=createCalendarApi({calendarAuth});
  const calendarJournal=createCalendarJournal({calendarStorage,calendarApi});
  let controller=null;

  function createController({ui,tab,calendarUi,uiLayout,uiModal,uiStatus,uiCloud,uiDateEditor}){
    if(controller)throw new Error('calendar_controller_already_composed');
    controller=createDomainsCalendarController({
      ui,tab,calendarUi,calendarSession,
      calendarStorage,calendarAuth,calendarApi,calendarJournal,
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

  return {createController,actionPorts};
}
