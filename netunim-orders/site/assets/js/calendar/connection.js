// @ts-check
import {createCalendarSessionRuntime} from './session-runtime.js';

/**
 * The Calendar display reads credential availability and supplies its scoped
 * projection; Google transport, connection intent and polling stay private.
 * @param {Omit<Parameters<typeof createCalendarSessionRuntime>[0],'authority'|'display'> & {auth:ReturnType<typeof import('./auth.js').createCalendarAuth>}} ports
 */
export function createCalendarConnection(ports){
  let composed=false;
  /** @param {Pick<Parameters<typeof createCalendarSessionRuntime>[0],'authority'|'display'>} projection */
  function createRuntime(projection){
    if(composed)throw new Error('calendar_connection_already_composed');
    composed=true;return createCalendarSessionRuntime({...ports,...projection});
  }
  return {
    createRuntime,
    captureOperation:()=>ports.auth.captureOperation(),
    hasUsableToken:()=>ports.auth.hasUsableToken(),
    configured:()=>ports.auth.configured(),
  };
}
