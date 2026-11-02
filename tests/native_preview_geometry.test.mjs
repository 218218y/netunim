import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nativePreviewGeometry} from '../netunim-orders/site/assets/js/shared/native-preview-geometry.js';
test('native Office geometry stays relative to the page, independent of docked consoles and browser frames',()=>{
 for(const devicePixelRatio of [1,1.25,1.5,2])for(const frame of [{outerWidth:1600,outerHeight:1000},{outerWidth:2100,outerHeight:1600,screenX:-1800,screenY:200}]){
  const box=nativePreviewGeometry({left:40,top:80,width:400,height:500},{...frame,devicePixelRatio,innerWidth:1000,innerHeight:700});
  assert.deepEqual(box,{coordinateSpace:'viewport',x:Math.round(40*devicePixelRatio),y:Math.round(80*devicePixelRatio),width:Math.round(400*devicePixelRatio),height:Math.round(500*devicePixelRatio),viewportWidth:Math.round(1000*devicePixelRatio),viewportHeight:Math.round(700*devicePixelRatio),scale:devicePixelRatio});
 }
});
test('clipped and hidden preview panes never extend outside the browser viewport',()=>{
 const win={devicePixelRatio:1,innerWidth:700,innerHeight:500};
 assert.deepEqual(nativePreviewGeometry({left:-10,top:-20,width:300,height:400},win),{coordinateSpace:'viewport',x:0,y:0,width:290,height:380,viewportWidth:700,viewportHeight:500,scale:1});
 for(const rect of [{left:650,top:0,width:200,height:400},{left:0,top:490,width:400,height:200},{left:NaN,top:0,width:400,height:400}])assert.equal(nativePreviewGeometry(rect,win),null);
});
