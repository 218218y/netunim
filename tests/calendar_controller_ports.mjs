import {createCalendarConnection} from '../netunim-orders/site/assets/js/calendar/connection.js';
import {createDomainsCalendarController} from '../netunim-orders/site/assets/js/domains/calendar/controller.js';

// Existing characterization fixtures describe infrastructure doubles. Bind
// them through the production capability, keeping the actual controller narrow.
export function createCalendarControllerFixture({calendarAuth,calendarApi,calendarJournal,requestCloudLogin=()=>{},...ports}){
  const connection=createCalendarConnection({auth:calendarAuth,api:calendarApi,journal:calendarJournal,session:ports.calendarSession,
    storage:ports.calendarStorage,effects:ports.effects,feedback:{toast:ports.toast,requestCloudLogin}});
  return createDomainsCalendarController({...ports,connection});
}
