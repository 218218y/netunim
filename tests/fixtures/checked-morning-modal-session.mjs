import {createMorningModalSession} from '../../netunim-orders/site/assets/js/domains/customers/morning-modal-session.js';
const ports={authority:{captureRead:()=>()=>undefined},account:{subscribe:()=>()=>undefined},surface:{find:()=>({isConnected:true}),isOpen:()=>true},presentation:{render:()=>undefined,clear:()=>undefined}};
const modal=createMorningModalSession(ports);
/** @type {number} */ const generation=modal.open('Morning',current=>String(current),'');
/** @type {boolean} */ const current=modal.isActive(generation);void current;
/** @type {AbortSignal} */ const signal=modal.signal;void signal;
// @ts-expect-error read authority must be captured synchronously
createMorningModalSession({...ports,authority:{captureRead:async()=>()=>{}}});
// @ts-expect-error asynchronous visibility cannot grant presentation authority
createMorningModalSession({...ports,surface:{...ports.surface,isOpen:async()=>true}});
// @ts-expect-error a text flag cannot prove native mounted identity
createMorningModalSession({...ports,surface:{...ports.surface,find:()=>({isConnected:'mounted'})}});
// @ts-expect-error cleanup must complete before a replacement account can render
createMorningModalSession({...ports,presentation:{...ports.presentation,clear:async()=>{}}});
// @ts-expect-error a deferred render cannot publish into a replacement modal
createMorningModalSession({...ports,presentation:{...ports.presentation,render:async()=>{}}});
// @ts-expect-error markup must be ready before the new surface is mounted
modal.open('Morning',async()=>'<form></form>','');
// @ts-expect-error generation must remain numeric
modal.isActive('current');
// @ts-expect-error subscription disposal must complete synchronously
createMorningModalSession({...ports,account:{subscribe:()=>async()=>{}}});
