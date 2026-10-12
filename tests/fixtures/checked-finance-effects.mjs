import {createFinanceBrowserEffects} from '../../shared/finance-browser-effects.js';

const effects = createFinanceBrowserEffects();
/** @type {boolean} */
export const online = effects.isOnline();
/** @type {Promise<void>} */
export const copied = effects.writeText('diagnostics');
/** @type {Promise<void>} */
export const delayed = effects.delay(180);
effects.saveJson('diagnostics.json', {version:1}, 'fallback.json');
/** @type {boolean} */
export const disposed = effects.dispose();

// @ts-expect-error Clipboard contents must be text, not an unencoded record.
effects.writeText({version:1});
// @ts-expect-error Backoff delays must be numeric.
effects.delay('180');
// @ts-expect-error A fallback download name must be text.
effects.saveJson(null, {}, 123);
// @ts-expect-error Timer ownership requires a numeric native timer handle.
createFinanceBrowserEffects({timers:{setTimeout:() => 'timer', clearTimeout:() => {}}});
