// @ts-check
import {cloudWriteScopeIsCurrent} from './cloud-write-scope.js';

/** @typedef {import('./cloud-write-scope.js').CloudWriteScope} CloudWriteScope */
/** @typedef {import('./cloud-write-scope.js').ScopedHead} ScopedHead */
/** @typedef {import('./storage-json.js').StorageJsonObject} JsonObject */
/** @typedef {{retry?:JsonObject|null,conflict?:JsonObject|null}} CloudControlPatch */
/**
 * @typedef {{
 *   scope:{read:()=>CloudWriteScope|null},
 *   leadership:{primary:()=>boolean,preparing:()=>boolean},
 *   control:{write:(value:CloudControlPatch,options:{expectedScope:CloudWriteScope|null,isCurrent:()=>boolean})=>Promise<unknown>}
 * }} CloudWriteAuthorityPorts
 */

// One authority decision for Main writes and their queued control transactions.
// A control result is storage evidence, never a document ACK. Storage still
// owns the transaction-time precondition and its durable receipt.
/** @param {CloudWriteAuthorityPorts} ports */
export function createCloudWriteAuthority({ scope, leadership, control }) {
  /** @param {CloudWriteScope|null} captured @param {ScopedHead|null} [head] @returns {boolean} */
  function isCurrent(captured, head = null) {
    return (
      leadership.primary() &&
      !leadership.preparing() &&
      cloudWriteScopeIsCurrent(captured, scope.read(), head)
    );
  }

  /** @param {CloudWriteScope|null} captured @param {CloudControlPatch} value @returns {Promise<unknown>} */
  async function setControl(captured, value) {
    try {
      return await control.write(value, {
        expectedScope: captured,
        isCurrent: () => isCurrent(captured),
      });
    } catch (error) {
      if (!isCurrent(captured)) return false;
      throw error;
    }
  }

  return { isCurrent, setControl };
}
