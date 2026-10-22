// Child of the Windows measurement driver. Each sample has a fresh heap.
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const [source,bytesText,scenario,alphabet='hebrew']=process.argv.slice(2);
const {createDocumentTextMatcher}=await import(pathToFileURL(resolve(source)).href);
const bytes=Number(bytesText),word=alphabet==='ascii'?'a':'אב',unit=word+' ',text=unit.repeat(Math.floor(bytes/Buffer.byteLength(unit)));
const query=Array.from({length:6},(_,i)=>i===5&&scenario==='missing-suffix'?'z':word).join(' ');
const textBytes=Buffer.byteLength(text);
globalThis.gc?.();
const before=process.memoryUsage(),cpu=process.cpuUsage(),started=performance.now();
const result=createDocumentTextMatcher(query,{matchMode:'proximity',proximityWords:50}).find(text,{maxMatches:scenario==='display-cap'?5000:1});
const wallMs=performance.now()-started;
if((result.matches.length>0)!==(scenario!=='missing-suffix'))throw Error('incorrect matcher result');
console.log(JSON.stringify({scenario,alphabet,textBytes,wallMs,cpuMicros:process.cpuUsage(cpu),before,after:process.memoryUsage(),matches:result.matches.length,capped:result.capped}));
// Let the owning parent sample the OS high-water counter before clean exit.
await new Promise(resolve=>setTimeout(resolve,60));
