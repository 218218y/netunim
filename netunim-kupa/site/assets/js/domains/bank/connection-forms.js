// Browser input ownership is separate from local Bridge requests. A form is
// valid only for the observed pairing on which it was rendered, including the
// initial unpaired form that accepts an explicitly pasted token.
export function createBankConnectionForms({ commands, readPairing, isActive }) {
  if (
    typeof commands?.configureBankBridge !== 'function' ||
    typeof commands?.saveBankBridgeToken !== 'function' ||
    typeof readPairing !== 'function' ||
    typeof isActive !== 'function'
  )
    throw new TypeError('kupa_bank_connection_form_ports_required');
  let releases = [],
    bound = null,
    generation = -1,
    disposed = false;
  function release() {
    for (const stop of releases) stop();
    releases = [];
    bound = null;
    generation = -1;
  }
  function bind() {
    release();
    if (disposed || !isActive()) return;
    bound = document.getElementById('bankBridgeCredentialsForm');
    generation = readPairing().generation;
    for (const id of ['bankBridgePairForm', 'bankBridgeCredentialsForm']) {
      const form = document.getElementById(id);
      if (!form) continue;
      const submit = (event) => event.preventDefault();
      form.addEventListener('submit', submit);
      releases.push(() => form.removeEventListener('submit', submit));
    }
  }
  function configure() {
    if (
      disposed ||
      !isActive() ||
      !bound ||
      document.getElementById('bankBridgeCredentialsForm') !== bound ||
      generation !== readPairing().generation
    )
      return false;
    const value = (id) => bound.querySelector('#' + id)?.value || '';
    const result = commands.configureBankBridge({
      token: document.getElementById('bankBridgeTokenInput')?.value || '',
      userCode: value('bankUserCodeInput'),
      password: value('bankPasswordInput'),
      businessBranchNumber: value('bankBusinessBranchNumberInput'),
      businessAccountNumber: value('bankBusinessAccountNumberInput'),
      homeBranchNumber: value('bankHomeBranchNumberInput'),
      homeAccountNumber: value('bankHomeAccountNumberInput'),
    });
    generation = readPairing().generation;
    return result;
  }
  function saveToken() {
    if (disposed || !isActive()) return false;
    const input = document.getElementById('bankBridgeTokenInput'),
      token = input?.value?.trim() || '';
    if (token && input) input.value = '';
    const result = commands.saveBankBridgeToken(token);
    // Token acceptance is synchronous. Explicit pairing makes the existing
    // draft form belong to that new device without replacing its input nodes.
    generation = readPairing().generation;
    return result;
  }
  return {
    bind,
    configure,
    saveToken,
    runtime: {
      dispose() {
        if (disposed) return false;
        disposed = true;
        release();
        return true;
      },
    },
  };
}
