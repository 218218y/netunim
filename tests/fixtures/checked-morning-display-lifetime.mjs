import {createMorningDisplayLifetime,clearMorningDisplay} from '../../netunim-orders/site/assets/js/domains/customers/morning-display-lifetime.js';
const display=createMorningDisplayLifetime({subscribeAccountScope:listener=>{void listener;return ()=>{}},onInvalidate:()=>{}});
/** @type {AbortSignal} */ const signal=display.signal;void signal;
// @ts-expect-error subscription cleanup must be synchronous and explicit
createMorningDisplayLifetime({subscribeAccountScope:async()=>()=>{},onInvalidate:()=>{}});
// @ts-expect-error visual invalidation is synchronous, not a persistence command
createMorningDisplayLifetime({subscribeAccountScope:()=>()=>{},onInvalidate:/** @param {number} revision */ revision=>{void revision}});
// @ts-expect-error account display clearing cannot finish asynchronously after a new login
createMorningDisplayLifetime({subscribeAccountScope:()=>()=>{},onInvalidate:async()=>{}});
clearMorningDisplay({isConnected:true},(title,body,foot)=>{void title;void body;void foot});
// @ts-expect-error rendering private display cleanup cannot be deferred into a later login
clearMorningDisplay({isConnected:true},async()=>{});
