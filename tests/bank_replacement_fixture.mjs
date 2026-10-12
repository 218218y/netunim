import {createBridgeReplacementCommand} from '../netunim-kupa/bank-bridge/replacement-command.mjs';
export function replacementFixture({shutdown=async()=>({response:{ok:true},data:{ok:true}}),token='fixture',wait=async()=>false,probe=async()=>({response:{ok:true},data:{service:'netunim-kupa-bank-bridge'}})}={}){
  let forced=0,shutdownCalls=0;
  const command=createBridgeReplacementCommand({probe,readToken:async()=>token,shutdown:async key=>{shutdownCalls++;return shutdown(key)},waitUntilStopped:wait,
    // Deliberately extraneous: this capability is not accepted by the command.
    forceStop:()=>{forced++}});
  return {stop:command.stop,forced:()=>forced,shutdownCalls:()=>shutdownCalls};
}
