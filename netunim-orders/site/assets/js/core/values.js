export {esc} from '../shared/html.js';


export const clone=o=>structuredClone(o);



export function uid(prefix='TRX'){return prefix+'-'+Date.now().toString(36).toUpperCase()+'-'+Math.random().toString(36).slice(2,7).toUpperCase()}
