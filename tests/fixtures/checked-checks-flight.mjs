import {createSharedChecksFlight} from '../../shared/shared-checks-flight.js';

/** @type {Record<string,Promise<boolean>|null>} */
const slots={};
const flight=createSharedChecksFlight({state:slots,pullKey:'pull',saveKey:'save',busyKey:'busy'});
/** @type {Promise<boolean>} */
export const receipt=flight.save(async()=>true);
/** @type {'pulling'|'saving'|'offline'|'conflict'|'deferred'|'idle'} */
export const status=flight.status({online:true,localWork:false});

// @ts-expect-error A serialized operation must supply a callable command.
flight.pull(Promise.resolve(true));
// @ts-expect-error A boolean flight cannot return text as confirmation.
flight.save(async()=> 'confirmed');
// @ts-expect-error Connectivity evidence must be boolean.
flight.status({online:'online'});
// @ts-expect-error Both reservation keys must be explicit.
createSharedChecksFlight({state:slots,pullKey:'pull',busyKey:'busy'});
// @ts-expect-error A flight slot cannot be used as a timer ID.
slots.save=123;
