// Queue identity is based on validated bytes, never a filename or invoice guess.
// Hashes stay in memory; the writer independently verifies the approved source.
export function createExpenseFileQueue({validate, hash}) {
  let cache = new WeakMap();
  function fingerprint(file) {
    if (!cache.has(file)) {
      const entries = cache;
      const pending = Promise.resolve().then(() => hash(file)).catch(error => {entries.delete(file); throw error;});
      entries.set(file, pending);
    }
    return cache.get(file);
  }
  async function prepare(selection, current, check) {
    check();
    const list = Array.from(selection), accepted = [], duplicates = [];
    if (!list.length) return {accepted, duplicates};
    if (list.length > 20) throw new Error('ניתן לבחור עד 20 קבצים בכל בחירה.');
    const seen = new Set();
    let bytes = current.reduce((sum, item) => sum + item.file.size, 0);
    for (const item of current) {seen.add(await fingerprint(item.file)); check();}
    for (const file of list) {
      const item = await validate(file); check();
      const identity = await fingerprint(item.file); check();
      if (typeof identity !== 'string' || !/^[a-f0-9]{64}$/.test(identity)) throw new Error('לא ניתן לאמת את זהות הקובץ.');
      if (seen.has(identity)) {duplicates.push(item); continue;}
      bytes += item.file.size;
      if (current.length + accepted.length >= 20 || bytes > 100 * 1024 * 1024) throw new Error('ניתן לשמור בתור עד 20 קבצים ובסך הכול עד 100MB.');
      seen.add(identity); accepted.push(item);
    }
    return {accepted, duplicates};
  }
  return {prepare, reset:() => {cache = new WeakMap();}};
}
