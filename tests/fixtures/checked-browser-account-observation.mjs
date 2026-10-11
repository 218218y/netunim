import {createAuthenticatedAccountScope} from '../../shared/authenticated-account-scope.js';
import {createBrowserAccountObservation} from '../../shared/browser-account-observation.js';
const scope=createAuthenticatedAccountScope({loadSession:()=>null});
const observer=createBrowserAccountObservation({scope,sessionKey:'fixture',rereadSession:()=>({user:{id:'A'}})});
const stop=observer.subscribe(value=>{
  /** @type {string|null} */ const owner=value.owner;
  /** @type {number} */ const epoch=value.epoch;
  void owner;void epoch;
  // @ts-expect-error auth owner is not a numeric journal sequence
  const sequence=/** @type {number} */ (value.owner);
  void sequence;
});
stop();
// @ts-expect-error credential reads must finish synchronously before publication
createBrowserAccountObservation({scope,sessionKey:'fixture',rereadSession:async()=>null});
// @ts-expect-error auth scope invalidation cannot be represented by an owner alone
observer.subscribe(/** @param {string} owner */ owner=>{void owner});
