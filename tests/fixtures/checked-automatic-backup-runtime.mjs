import {createAutomaticBackupRuntime} from '../../shared/automatic-backup-runtime.js';
const target={folder:'selected'};
/** @param {{note:string}} value */
const clonePayload=value=>structuredClone(value);
const runtime=createAutomaticBackupRuntime({readTarget:()=>target,clonePayload,
  /** @param {{folder:string}} directory @param {{note:string}} payload */
  write:async(directory,payload,continuation)=>{continuation.defer(1000);return directory.folder+payload.note},onError:()=>{}});
/** @type {string|null} */ const result=await runtime.submit({note:'retained'});
runtime.schedule({note:'latest'},1000);
// @ts-expect-error a directory target is an object identity, not a timer ID
createAutomaticBackupRuntime({readTarget:()=>123,clonePayload,write:async()=>null,onError:()=>{}});
// @ts-expect-error a backup payload has a checked boundary
runtime.submit({note:123});
// @ts-expect-error a backup deadline is numeric
runtime.schedule({note:'text'},'1000');
// @ts-expect-error actual completion is asynchronous
const guessed=/** @type {string|null} */(runtime.submit({note:'text'}));
void result;void guessed;
