import {createDebouncedTask} from '../../shared/debounced-task.js';

const task = createDebouncedTask({delay:180, onError:error => String(error)});
/** @type {boolean} */
export const scheduled = task.schedule(async () => 42);
/** @type {Promise<void>} */
export const drained = task.drain();
/** @type {boolean} */
export const cancelled = task.cancel();
/** @type {boolean} */
export const disposed = task.dispose();

// @ts-expect-error A delay must be numeric.
createDebouncedTask({delay:'180', onError:() => {}});
// @ts-expect-error Background failures need an observer.
createDebouncedTask({delay:180});
// @ts-expect-error Timer allocation cannot return a formatted ID.
createDebouncedTask({delay:180, onError:() => {}, timers:{setTimeout:() => 'timer', clearTimeout:() => {}}});
// @ts-expect-error A wakeup must supply a callable operation.
task.schedule(Promise.resolve());
/** @type {Promise<boolean>} */
// @ts-expect-error Draining a background operation does not produce a durability receipt.
export const notAReceipt = task.drain();
