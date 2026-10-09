import {createCreditPreferences} from '../../netunim-kupa/site/assets/js/platform/credit-preferences.js';
const preferences=createCreditPreferences({now:()=>123});
const result=preferences.read();
if(result.ok){
  /** @type {boolean} */ const enabled=result.value.enabled;
  /** @type {number} */ const at=result.value.attemptAt;
  void enabled;void at;
}else{
  /** @type {import('../../netunim-kupa/site/assets/js/platform/credit-preferences.js').PreferenceFailure} */ const failure=result.error;
  void failure;
}
// @ts-expect-error failed reads do not provide an enabled preference
const guessed=result.value.enabled;
// @ts-expect-error a mode must be normalized before passing the port boundary
preferences.setMode('full');
// @ts-expect-error enable is a boolean, never a persisted string
preferences.setEnabled('0');
// @ts-expect-error storage reads are synchronous; no cached promise preference
createCreditPreferences({storage:{getItem:async()=>null,setItem(){},removeItem(){}}});
void guessed;
