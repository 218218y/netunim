import {EventEmitter} from 'node:events';
import {createMaintenanceProcessOwner} from '../netunim-orders/document-bridge/maintenance-process-owner.mjs';
export function deferred() { let resolve, reject; const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}; }
export function fixture(options={}) {
  const children=[],timers=new Map(),sent=[],logs=[];let sequence=0;
  const ports={host:{isHeld:async()=>false,launch:()=>{const child=Object.assign(new EventEmitter(),{pid:11+children.length,connected:true});children.push(child);return child},
    requestStop:async child=>{sent.push(child)}},timers:{setTimeout:callback=>{const id=++sequence;timers.set(id,callback);return id},clearTimeout:id=>timers.delete(id)},
    now:()=>`time-${++sequence}`,log:async message=>{logs.push(message)}};
  Object.assign(ports.host,options.host);Object.assign(ports,options.ports);
  return {owner:createMaintenanceProcessOwner(ports),ports,children,timers,sent,logs};
}
export function finish(child,result={processed:1}) { child.emit('message',{type:'pdf-maintenance-result',result});child.connected=false;child.emit('close',0,null); }
