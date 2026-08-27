import {comparableBackupPayload} from '../state/serialization.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStorageFiles({}){
async function permissionFor(handle){if(!handle)return false;let p=await handle.queryPermission?.({mode:'readwrite'});if(p==='granted')return true;p=await handle.requestPermission?.({mode:'readwrite'});return p==='granted'}

async function readJsonHandle(handle){const f=await handle.getFile();const txt=await f.text();return JSON.parse(txt)}

async function writeJsonHandle(handle,obj){const text=JSON.stringify(obj,null,2),writable=await handle.createWritable();await writable.write(text);await writable.close()}

async function writeJsonHandleVerified(handle,obj){await writeJsonHandle(handle,obj);const saved=await readJsonHandle(handle);if(comparableBackupPayload(saved)!==comparableBackupPayload(obj)||Number(saved?._meta?.revision||0)!==Number(obj?._meta?.revision||0))throw new Error('אימות תוכן קובץ הנתונים לאחר השמירה נכשל');return saved}

return { permissionFor, readJsonHandle, writeJsonHandle, writeJsonHandleVerified };
}
