import {createAutomationPreferences} from '../../netunim-orders/site/assets/js/domains/finance/automation-preferences.js';
const preferences={getBridgeToken:()=>'',bankAutoEnabled:()=>true,creditAutoEnabled:()=>false,creditAutoMode:()=>'smart'};
const owner=createAutomationPreferences({preferences,onFailure:()=>undefined});
const result=owner.eligible('bank');
if(result){/** @type {number} */const delay=result.delay;void delay;}
owner.setEnabled('credit',false);
// @ts-expect-error only known resource owners can change automatic permission
owner.setEnabled('checks',true);
// @ts-expect-error the persisted string is not a boolean permission
owner.setEnabled('bank','0');
// @ts-expect-error a preference read is synchronous, never a cached promise
createAutomationPreferences({preferences:{...preferences,bankAutoEnabled:async()=>true},onFailure:()=>undefined});
// @ts-expect-error failure publication must finish before the blocked start returns
createAutomationPreferences({preferences,onFailure:async()=>{}});
