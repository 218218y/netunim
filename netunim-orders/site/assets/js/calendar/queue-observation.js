// @ts-check

// Observes work in this JavaScript realm, not a persisted schema/version or an
// ACK. A read cannot confirm emptiness while an append is still committing or
// any queue mutation started/settled after that read began.
export function createCalendarQueueObservation(){
  let generation=0,writes=0;
  function beginWrite(){
    generation++;writes++;let settled=false;
    return ()=>{if(settled)return false;settled=true;writes--;generation++;return true};
  }
  function capture(){const observed=generation;return ()=>writes===0&&generation===observed}
  function isSettled(){return writes===0}
  return {beginWrite,capture,isSettled};
}
