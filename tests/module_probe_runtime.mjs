// Copied into the temporary test site only. Never adds properties to production APIs.
export const publicBindings = Object.create(null);
const lexicalMethods = new WeakMap();

export function capturePublicApi(api, setters = {}) {
  if (!api || typeof api !== 'object') return api;
  lexicalMethods.set(api, {...lexicalMethods.get(api), ...setters});
  const visited = new WeakSet();
  function expose(object) {
    if (!object || typeof object !== 'object' || visited.has(object)) return;
    const prototype = Object.getPrototypeOf(object);
    if (prototype !== Object.prototype && prototype !== null) return;
    visited.add(object);
    const descriptors = Object.getOwnPropertyDescriptors(object);
    // Children first: the composition's explicit public method takes precedence.
    for (const descriptor of Object.values(descriptors)) {
      if (descriptor.enumerable && 'value' in descriptor && typeof descriptor.value === 'object') expose(descriptor.value);
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || typeof descriptor.value !== 'function') continue;
      Object.defineProperty(publicBindings, key, {
        configurable: true, enumerable: true,
        get: () => object[key].bind(object),
        set(value) {
          if (!Reflect.set(object, key, value)) throw new TypeError(`Public method ${key} is read-only`);
          lexicalMethods.get(object)?.[key]?.(value);
        },
      });
    }
  }
  expose(api);
  return api;
}
