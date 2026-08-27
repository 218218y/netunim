import {prepareStateData} from './serialization.js';

// Dependencies are supplied by the composition root; this module has no startup side effects.
export function createStateSelectors({model}){
function prepareState(...args){return prepareStateData(model.state,...args)}

return { prepareState };
}
