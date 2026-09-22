// Opt-in diagnostics: bounded durations only, never business data or network I/O.
const samples=new Map();
let enabled=false,observer=null,epoch=0;
const noop=()=>{};
function record(name,duration){if(!enabled||!Number.isFinite(duration))return;const rows=samples.get(name)||[];rows.push(duration);if(rows.length>120)rows.shift();samples.set(name,rows)}
// Numeric diagnostics (bytes/passes), using the same bounded opt-in sink.
export function recordPerformanceValue(name,value){record(name,value)}
export function performanceEnabled(){return enabled}
export function configurePerformance(value=true){
  enabled=!!value;epoch++;observer?.disconnect();observer=null;
  if(enabled&&globalThis.PerformanceObserver?.supportedEntryTypes?.includes('longtask')){
    observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())record('longtask',entry.duration)});
    observer.observe({type:'longtask'});
  }
}
export function performanceSummary(){return Object.fromEntries([...samples].map(([name,rows])=>{const sorted=[...rows].sort((a,b)=>a-b);return [name,{count:rows.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)}]}))}
export function clearPerformance(){samples.clear()}
export function beginMeasure(name,{paint=false}={}){
  if(!enabled)return noop;
  const start=performance.now(),startedEpoch=epoch;let finished=false;
  if(paint&&typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(()=>{if(startedEpoch===epoch)record(`${name}:paint-opportunity`,performance.now()-start)}));
  return ()=>{if(finished)return;finished=true;if(startedEpoch===epoch)record(name,performance.now()-start)};
}
