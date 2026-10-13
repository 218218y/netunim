// @ts-check

// One namespace owns accepted file jobs. Rejection is observed by the caller
// and does not poison later jobs; drainage also joins jobs accepted meanwhile.
export function createFileTaskOwner() {
  let tail = Promise.resolve();
  /** @template T @param {()=>T|PromiseLike<T>} command @returns {Promise<T>} */
  function run(command) {
    const task = tail.then(command);
    tail = task.then(
      () => {},
      () => {}
    );
    return task;
  }
  async function drain() {
    let observed;
    do {
      observed = tail;
      await observed;
    } while (observed !== tail);
  }
  return Object.freeze({ run, drain });
}

/**
 * Wait for every accepted attempt, retaining the first observed failure.
 * @template T
 * @param {readonly PromiseLike<T>[]} attempts
 * @returns {Promise<T[]>}
 */
export async function joinFileAttempts(attempts) {
  let failed = false;
  /** @type {unknown} */
  let failure;
  const results = await Promise.allSettled(
    attempts.map(async (attempt) => {
      try {
        return await attempt;
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
        }
        throw error;
      }
    })
  );
  if (failed) throw failure;
  return results.map((result) => {
    if (result.status === 'rejected') throw result.reason;
    return result.value;
  });
}
