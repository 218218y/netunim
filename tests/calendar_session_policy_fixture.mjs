import {declaration,tokens} from './bank_policy_ast_fixture.mjs';

// Expand only the new projection/port names. Delivery order, transaction
// confirmation and retry decisions must match the immutable pre-extraction AST.
export function originalCalendarSyncPolicy(source){
  const node=declaration(source,'syncNow');
  return tokens(source.slice(node.start,node.end))
    .replaceAll('session.','calendarSession.').replaceAll('auth.','calendarAuth.')
    .replaceAll('storage.','calendarStorage.').replaceAll('api.','calendarApi.').replaceAll('journal.','calendarJournal.')
    .replaceAll('feedback.toast(', 'toast(').replaceAll('display.status()', 'updateCalendarStatus()')
    .replaceAll('display.prefetchRange()', 'prefetchRange()')
    .replaceAll('display.cacheCovers(range)', 'loadedRangeCovers(range)&&cacheIsFresh()')
    .replace('let syncedSnapshot=null;let syncSucceeded=', 'let syncedSnapshot=null,syncSucceeded=')
    .replaceAll('display.setCalendars(calendars);','calendarUi.calendars=calendars;')
    .replaceAll('display.setPending(pending);','calendarUi.pending=pending;')
    .replaceAll('display.setPending(pending)}','calendarUi.pending=pending}')
    .replaceAll('const publication={};','let publicationReceipt=null;')
    .replaceAll('publication.receipt','publicationReceipt')
    .replaceAll('display.publish(snapshot,pending)',"if(ui.currentView==='calendar'&&calendarRangeContains(snapshot,calendarRange())){loadSnapshotIntoUi(snapshot,pending);renderCalendarBody()}")
    .replaceAll('display.isOpen()',"ui.currentView==='calendar'")
    .replaceAll('display.render()', 'renderCalendarBody()')
    .replaceAll('syncedSnapshot!==null&&','')
    .replaceAll('display.containsPrefetch(syncedSnapshot)','calendarRangeContains(syncedSnapshot,prefetchRange())')
    .replaceAll('details(error).code','error?.code').replaceAll('details(error).status','error?.status')
    .replaceAll('errorMessage(error)', 'error?.message')
    .replace('if(!quiet&&error?.message)toast(error?.message)', 'if(!quiet&&error?.message)toast(error.message)')
    .replace('catch(error){if(!quiet)toast(error?.message);return false}', 'catch(error){if(!quiet)toast(error.message);return false}');
}
