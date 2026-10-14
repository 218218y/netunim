// @ts-check
import {createMorningDocumentMedia} from '../domains/customers/morning-document-media.js';
import {createMorningMediaEffects} from '../platform/morning-media-effects.js';
import {createMorningMediaPresentation} from '../platform/morning-media-presentation.js';
/** @typedef {import('../domains/customers/morning-document-media.js').MediaRequest} MediaRequest */
/** @typedef {import('../core/morning-operation-scope.js').MorningAssertion} MorningAssertion */
/** @param {{request:MediaRequest,modal:(title:string,body:string,foot:string)=>void,toast:(text:string)=>void}} ports */
export function createMorningMediaComposition({request,modal,toast}){
  /** @param {{capture:()=>MorningAssertion,onStandalone:(surface:HTMLElement|null)=>void}} projection */
  function create({capture,onStandalone}){
    return createMorningDocumentMedia({request,authority:{capture},presentation:createMorningMediaPresentation({modal,onStandalone}),platform:createMorningMediaEffects(),feedback:{toast}});
  }
  return {create};
}
