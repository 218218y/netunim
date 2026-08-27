export {esc} from '../shared/html.js';


export function clone(x){return JSON.parse(JSON.stringify(x))}



export function uid(prefix){return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`}
