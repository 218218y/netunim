// @ts-check
import { createFileTaskOwner } from './file-task-owner.mjs';

/** @typedef {Record<string,unknown>} JsonDocument */
/** @typedef {{read:()=>Promise<unknown>,write:(text:string)=>Promise<void>,clear:()=>Promise<void>}} JsonArtifactFiles */
/** @param {{files:JsonArtifactFiles}} ports */
export function createJsonArtifactOwner({ files }) {
  if (
    typeof files?.read !== 'function' ||
    typeof files?.write !== 'function' ||
    typeof files?.clear !== 'function'
  )
    throw new Error('json_artifact_ports_required');
  const jobs = createFileTaskOwner();
  /** @param {unknown} value @returns {string} */
  function serialize(value) {
    const text = JSON.stringify(value, null, 2);
    if (typeof text !== 'string') throw new TypeError('json_artifact_document_required');
    return text;
  }
  /** @param {JsonDocument} document @returns {Promise<void>} */
  function write(document) {
    try {
      const text = serialize(document);
      return jobs.run(() => files.write(text));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  /** @param {JsonDocument} patch @returns {Promise<void>} */
  function update(patch) {
    try {
      // Undefined fields retain their existing deletion semantics. The accepted
      // patch is detached before entering the queue, including nested values.
      const captured = structuredClone(patch);
      return jobs.run(async () => {
        const current = await files.read();
        // Object wrapping keeps historical scalar/array spreading semantics;
        // object spread preserves __proto__ as data instead of invoking a setter.
        await files.write(serialize({ ...Object(current), ...captured }));
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
  return Object.freeze({
    read: () => jobs.run(files.read),
    write,
    update,
    clear: () => jobs.run(files.clear),
    drain: jobs.drain,
  });
}
