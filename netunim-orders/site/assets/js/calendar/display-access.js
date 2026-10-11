// @ts-check
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function object(value){return value!==null&&typeof value==='object'&&!Array.isArray(value)}
/**
 * This is display authorization, never an ACK or a queue cleanup decision.
 * Historical caches without an app owner remain intact until a verified
 * Google read creates an attributed cache. No inferred ownership from prefs.
 * @param {unknown} snapshot @param {unknown} operations
 * @param {unknown} storedAccount @param {string} owner
 * @returns {{snapshot:Record<string,unknown>,pending:Record<string,unknown>[]}|null}
 */
export function authorizeCalendarDisplay(snapshot,operations,storedAccount,owner){
  if(!owner||!object(snapshot)||snapshot.owner!==owner||typeof snapshot.accountId!=='string'||!snapshot.accountId||snapshot.accountId!==storedAccount)return null;
  if(!Array.isArray(snapshot.calendars)||!Array.isArray(snapshot.events)||!Array.isArray(operations))return null;
  const calendars=new Set();
  for(const calendar of snapshot.calendars){if(!object(calendar)||typeof calendar.id!=='string'||!calendar.id)return null;calendars.add(calendar.id)}
  /** @type {Record<string,unknown>[]} */ const pending=[];
  for(const operation of operations){if(!object(operation)||typeof operation.calendarId!=='string'||!calendars.has(operation.calendarId))return null;pending.push(operation)}
  return {snapshot,pending};
}
