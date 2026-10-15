import {startupMark as mark} from '../shared/startup-timing.js';
export function startupMark(name){mark(name);try{globalThis.performance?.mark?.(`orders-startup:${name}`)}catch{}}
