import {createStateNormalization as createStateNormalizationWithPorts} from '../state/normalization.js';
import {normalizeBankFeed} from '../domains/bank/feed.js';
import {normalizeCreditSync} from '../domains/credit/sync-feed.js';
import {inactiveCreditExpired} from '../domains/credit/model.js';

// The composition layer connects persisted state to the policies owned by each domain.
const policies=Object.freeze({normalizeBankFeed,normalizeCreditSync,inactiveCreditExpired});

export function createStateNormalization(options){
  return createStateNormalizationWithPorts({...options,policies});
}
