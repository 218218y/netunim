// @ts-check
import {createMorningDisplayLifetime} from './morning-display-lifetime.js';
/** @typedef {import('../../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */

/**
 * One mounted Morning surface owns form actions and confirmation presentation.
 * Accepted financial work belongs to the separate operation lifetime.
 * @template {{isConnected:boolean}} Surface
 * @param {{
 * authority:{captureRead:()=>MorningAssertion},
 * account:{subscribe:(listener:()=>void)=>()=>undefined},
 * surface:{find:(generation:number)=>Surface|null,isOpen:()=>boolean},
 * presentation:{render:(title:string,body:string,foot:string)=>undefined,clear:(owned:Surface)=>undefined}
 * }} ports
 */
export function createMorningModalSession({authority,account,surface,presentation}){
  let generation=0;
  /** @type {Surface|null} */ let element=null;
  /** @type {MorningAssertion|null} */ let assertion=null;
  const display=createMorningDisplayLifetime({subscribeAccountScope:account.subscribe,onInvalidate:()=>{
    const owned=element,ownsCurrent=owned!==null&&surface.find(generation)===owned;
    generation++;element=null;assertion=null;
    if(ownsCurrent&&owned?.isConnected)presentation.clear(owned);
  }});
  /** @param {number} observed @returns {boolean} */
  function isActive(observed){
    try{assertion?.()}catch{return false}
    return assertion!==null&&observed===generation&&element?.isConnected===true&&surface.isOpen()===true&&surface.find(generation)===element;
  }
  /** @returns {undefined} */
  function assert(){
    if(!isActive(generation))throw Object.assign(new Error('חלון Morning נסגר או הוחלף. יש לפתוח אותו מחדש לפני המשך.'),{code:'MORNING_OPERATION_SCOPE_CHANGED'});
    assertion?.();
  }
  /** @param {string} title @param {(generation:number)=>string} body @param {string} foot @returns {number} */
  function open(title,body,foot){
    const captured=authority.captureRead();captured();display.renew();
    const observed=++generation;assertion=captured;element=null;
    presentation.render(title,body(observed),foot);
    captured();if(generation===observed)element=surface.find(observed);
    return observed;
  }
  return {open,assert,isActive,dispose:display.dispose,get generation(){return generation},get element(){return isActive(generation)?element:null},get signal(){return display.signal}};
}
