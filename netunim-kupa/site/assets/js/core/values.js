export {esc} from '../shared/html.js';


/** @template T @param {T} x @returns {T} */
export function clone(x){return JSON.parse(JSON.stringify(x))}



/** @param {string} prefix */
export function uid(prefix){return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`}
