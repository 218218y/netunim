export function startupMark(name){try{globalThis.performance?.mark?.(`orders-startup:${name}`)}catch{}}
