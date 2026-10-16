// @ts-check
export const RESTORE_GROUP_NAMESPACES=Object.freeze({orders:'orders.restore.group.v1',kupa:'kupa.restore.group.v1'});

/** @param {unknown} value @returns {value is string} */
function restoreGroupKeyPart(value){return typeof value==='string'&&value.trim().length>0}
/** @returns {never} */
function invalidRestoreGroupKey(){throw new Error('storage_restore_group_key_required')}

/** One persisted key contract for the restore store and its storage adapter.
 * Existing current/archive/server keys retain their exact bytes.
 * @param {string} namespace */
export function createRestoreGroupKeys(namespace){
  if(!restoreGroupKeyPart(namespace))return invalidRestoreGroupKey();
  const current=`${namespace}:current`,archivePrefix=`${namespace}:archive:`,serverPrefix=`${current}:server:`;
  /** @param {string} prefix @param {string} part */
  function scoped(prefix,part){
    if(!restoreGroupKeyPart(part))return invalidRestoreGroupKey();
    return prefix+part;
  }
  /** @param {unknown} key @returns {string} */
  function read(key){
    if(typeof key==='string'&&(key===current||
      key.startsWith(archivePrefix)&&restoreGroupKeyPart(key.slice(archivePrefix.length))||
      key.startsWith(serverPrefix)&&restoreGroupKeyPart(key.slice(serverPrefix.length))))return key;
    return invalidRestoreGroupKey();
  }
  return Object.freeze({current,archive:/** @param {string} id */id=>scoped(archivePrefix,id),
    server:/** @param {string} owner */owner=>scoped(serverPrefix,owner),read});
}
