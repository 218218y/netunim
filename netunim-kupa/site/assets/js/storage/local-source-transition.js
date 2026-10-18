// @ts-check

/** @typedef {()=>undefined} SourceAssertion */
/** @param {{captureScope:()=>SourceAssertion,drain:()=>Promise<void>,setBusy:(busy:boolean)=>void}} ports */
export function createLocalSourceTransition({captureScope,drain,setBusy}){
  let busy=false;
  /**
   * @template Candidate, Result
   * @param {(assertCurrent:SourceAssertion)=>Promise<Candidate>} prepare
   * @param {(candidate:Candidate,assertCurrent:SourceAssertion)=>Promise<Result>} adopt
   * @returns {Promise<Result>}
   */
  async function run(prepare,adopt){
    if(busy)throw new Error('storage_source_transition_busy');
    busy=true;
    try{
      setBusy(true);
      const assertCurrent=captureScope();
      // Ask for native permission while the user's activation is still current.
      // Preparation never borrows or changes the active file references.
      const candidate=await prepare(assertCurrent);assertCurrent();
      // Accepted file/save work settles against its original handles before the
      // candidate's data can be imported and installed.
      await drain();assertCurrent();
      return await adopt(candidate,assertCurrent);
    }finally{busy=false;setBusy(false)}
  }
  return {run,isPending:()=>busy};
}
