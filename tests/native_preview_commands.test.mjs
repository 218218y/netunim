import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDocumentOperations} from '../netunim-orders/document-bridge/document-operations.mjs';
function fixture(){
 const calls=[];
 const owner=createDocumentOperations({registry:{resolve:async()=>({row:{fullPath:'C:\\synthetic\\invoice.docx'},stat:{isDirectory:()=>false}})},preview:{cache:{},files:{readText:async()=>{},readBinary:async()=>{}}},pdf:{index:{},preview:{},policy:{}},
  native:{isRunning:()=>true,command:async(...args)=>{calls.push(args);return 'OK';}},search:{},platform:{host:{platform:'win32'}},audit:{write:async()=>{}}});
 return {owner,calls};
}
const geometry={coordinateSpace:'viewport',x:25,y:50,width:400,height:500,viewportWidth:1000,viewportHeight:700};
test('browser viewport coordinates reach native OPEN and MOVE without being converted to guessed screen coordinates',async()=>{
 const f=fixture();await f.owner.native.open('opaque',geometry);await f.owner.native.move(geometry);
 assert.equal(f.calls[0][0],'OPEN_VIEWPORT');assert.deepEqual(f.calls[0][1].slice(1),[25,50,400,500,1000,700]);
 assert.deepEqual(f.calls[1].slice(0,2),['MOVE_VIEWPORT',[25,50,400,500,1000,700]]);
 await f.owner.native.move({x:-100,y:20,width:300,height:200});assert.equal(f.calls[2][0],'MOVE');
});
test('invalid viewport dimensions and overflow are rejected before invoking a native host',async()=>{
 for(const patch of [{x:-1},{y:NaN},{width:0},{viewportWidth:0},{viewportHeight:20001},{x:900},{coordinateSpace:'viewport',height:1000}]){
  const f=fixture();await assert.rejects(f.owner.native.open('opaque',{...geometry,...patch}),/Invalid native preview viewport geometry/);assert.equal(f.calls.length,0);
 }
});
