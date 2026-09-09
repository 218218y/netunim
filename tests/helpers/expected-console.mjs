import assert from 'node:assert/strict';

function diagnosticKey(args){
  const label=String(args[0]??'');
  const detail=args[1];
  const message=detail instanceof Error?detail.message:String(detail??'');
  return `${label}\u0000${message}`;
}

export async function withExpectedConsoleErrors(expected,action){
  const original=console.error,captured=[];
  console.error=(...args)=>captured.push(args);
  try{
    const result=await action();
    const actual=captured.map(diagnosticKey).sort();
    const wanted=expected.map(([label,message])=>`${label}\u0000${message}`).sort();
    assert.deepEqual(actual,wanted,'unexpected console.error diagnostics while exercising an expected failure');
    return result;
  }catch(error){
    for(const args of captured)original(...args);
    throw error;
  }finally{
    console.error=original;
  }
}
