export function createShellActions({ uiModal }) {
  const dismissModal = (...args) => uiModal.dismissModal(...args);
  const actions = {
    'select-input': (element, event) => { return element.select(); },
    'close-modal': (element, event) => { return dismissModal(); },
    'blur-on-enter': (element, event) => { if (event.key === 'Enter')
      return element.blur(); },
  };
  return actions;
}
