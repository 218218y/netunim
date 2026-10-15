import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {declaration,tokens} from './bank_policy_ast_fixture.mjs';
import {originalCalendarSyncPolicy} from './calendar_session_policy_fixture.mjs';
import {baseline as projectionBaseline,semanticPolicy} from './calendar_projection_policy_fixture.mjs';

const controller=readFileSync(new URL('../netunim-orders/site/assets/js/domains/calendar/controller.js',import.meta.url),'utf8');
const editor=readFileSync(new URL('../netunim-orders/site/assets/js/domains/calendar/editor-commands.js',import.meta.url),'utf8');
const baseline=JSON.parse(readFileSync(new URL('./fixtures/calendar-preserved-policy.json',import.meta.url),'utf8'));
const session=readFileSync(new URL('../netunim-orders/site/assets/js/calendar/session-runtime.js',import.meta.url),'utf8');
function policy(source,name){
  if(['queueCalendarMutation','saveQuickCalendarEvent','saveCalendarEvent','deleteCalendarEvent'].includes(name)){
    if(source===controller)source=editor;
    source=source.replaceAll('editor.surface()','ownedModal').replaceAll('editor.selectedCalendar()',"$('#calendarCalendarId')?.value").replaceAll('editor.closeSurface(surface);',"if(surface?.isConnected&&ownedModal===surface){closeModal();ownedModal=null;editorAuthority=null}");
  }
  const moved=['eventKey','writableCalendar','editableEvent','eventReadOnlyReason','decorateEvent','applyPending'];
  const file=moved.includes(name)?'read-model.js':['readEditorPayload','readQuickEditorPayload'].includes(name)?'editor-payload.js':null;
  if(file){
    const current=readFileSync(new URL('../netunim-orders/site/assets/js/domains/calendar/'+file,import.meta.url),'utf8');
    const original=projectionBaseline.functions[name].source;
    assert.deepEqual(semanticPolicy(current,name),semanticPolicy(original,name));
    return tokens(original);
  }
  const node=declaration(source,name);
  return tokens(source.slice(node.start,node.end))
    .replaceAll('connection.hasUsableToken','calendarAuth.hasUsableToken')
    .replaceAll('sessionRuntime.wake','wake').replaceAll('sessionRuntime.syncNow','syncNow');
}
function fingerprint(value){return createHash('sha256').update(value).digest('hex')}

for(const [name,expected] of Object.entries(baseline.functions))test(`Calendar ${name} preserves the pre-extraction editor/overlay policy`,()=>{
  assert.equal(fingerprint(name==='syncNow'?originalCalendarSyncPolicy(session):policy(controller,name)),expected,`business policy drift from ${baseline.commit}`);
});
test('the immutable Calendar policy detects removal of optimistic patch attribution',()=>{
  const changed=editor.replace("baseEtag:existing.etag||''","baseEtag:''");assert.notEqual(changed,editor);
  assert.notEqual(fingerprint(policy(changed,'queueCalendarMutation')),baseline.functions.queueCalendarMutation);
});
test('the display controller cannot reacquire Google transport or private sync handles',()=>{
  const root=declaration(controller,'createDomainsCalendarController');
  const names=root.params[0].properties.map(property=>property.key.name);
  assert.ok(names.length<=16,`controller width: ${names.length}`);
  for(const name of ['calendarAuth','calendarApi','calendarJournal','requestCloudLogin'])assert.equal(names.includes(name),false);
  for(const name of ['syncFlight','reconnectFlight','ensureAccount','beginRememberedReconnect'])assert.equal(controller.includes(name),false);
  const runtime=declaration(session,'createCalendarSessionRuntime');
  assert.ok(runtime.params[0].properties.length<=9,'session runtime exceeds its nine explicit ports');
  assert.equal(session.includes('querySelector'),false,'sync owner must not inspect DOM');
});
