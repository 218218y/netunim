import {TAB_LOCK} from '../state/constants.js';
import {createPrimaryTabLock} from '../shared/tab-lock.js';

export function createStorageTabLock({tab,showSecondaryTabGuard}){
  return createPrimaryTabLock({lockName:TAB_LOCK,tab,showSecondaryTabGuard});
}
