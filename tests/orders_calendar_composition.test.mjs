import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdersCalendarRuntime} from '../netunim-orders/site/assets/js/composition/calendar.js';

test('Calendar composition keeps infrastructure, UI binding, and delegated actions in order',()=>{
  const unexpected=()=>assert.fail('Calendar performed network or UI work during composition');
  assert.throws(()=>createOrdersCalendarRuntime({calendarSession:{}}),/calendar_cloud_port_required/);

  const calendarSession={};
  const runtime=createOrdersCalendarRuntime({calendarSession,supaFetch:unexpected,accountScope:()=>({owner:'fixture',epoch:1})});
  assert.throws(()=>runtime.actionPorts(),/calendar_controller_not_composed/);

  const controller=runtime.createController({
    ui:{currentView:'dashboard'},tab:{primaryTab:true},calendarUi:{},
    uiLayout:{mountViewLayout:unexpected},
    uiModal:{modal:unexpected,closeModal:unexpected,confirmDialog:unexpected},
    uiStatus:{toast:unexpected},uiCloud:{loginModal:unexpected},
    uiDateEditor:{dateEditorMarkup:unexpected,setDateValue:unexpected},
  });
  assert.equal(typeof controller.start,'function');
  assert.equal(typeof controller.resumeAfterCloudLogin,'function');
  assert.equal(typeof runtime.actionPorts().calendarAuthAction,'function');
  assert.equal(typeof runtime.actionPorts().calendarSaveEvent,'function');
  assert.throws(()=>runtime.createController({}),/calendar_controller_already_composed/);
});
