// One bounded timeline per document. Diagnostics never grant startup authority.
// Imports are evaluated before main's body, so the first import brackets module
// evaluation separately from composition. Parsing may overlap network loading.
const names=new Set([
  'evaluation-start','composition-start','composition-end','boot-start',
  'primary-tab-ready','storage-owner-ready','recovery-start','local-recovered',
  'first-view-render','boot-complete','command-ready',
]);

/** @param {{now:()=>number,mark?:(name:string)=>unknown}|undefined} clock */
export function createStartupTiming(clock){
  /** @type {Map<string,number>} */
  const marks=new Map();
  /** @param {string} name */
  function mark(name){
    if(!names.has(name)||marks.has(name))return;
    try{
      const time=clock?.now();
      if(typeof time!=='number'||!Number.isFinite(time)||time<0)return;
      marks.set(name,time);
      clock?.mark?.(`netunim-startup:${name}`);
    }catch{/* Optional diagnostics cannot change a business outcome. */}
  }
  function snapshot(){
    /** @param {string} start @param {string} end */
    const duration=(start,end)=>{
      const a=marks.get(start),b=marks.get(end);
      return a!==undefined&&b!==undefined?Math.max(0,b-a):null;
    };
    return {
      marks:Object.fromEntries(marks),
      durations:{
        moduleEvaluation:duration('evaluation-start','composition-start'),
        composition:duration('composition-start','composition-end'),
        localRecovery:duration('recovery-start','local-recovered'),
        boot:duration('boot-start','boot-complete'),
        firstView:marks.get('first-view-render')??null,
        commandReady:marks.get('command-ready')??null,
      },
    };
  }
  return {mark,snapshot};
}

const timing=createStartupTiming(globalThis.performance);
export const startupMark=timing.mark;
export const startupSnapshot=timing.snapshot;
startupMark('evaluation-start');
