import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';

// The rendered credential form owns its captured pairing and listener. Each
// confirmation is accepted before awaiting the shell and cannot target a new
// pairing or rerender a replacement form after its asynchronous command.
export function createBankConnectionCommands({ controller, confirmDialog, render, isActive }) {
  const work = createRuntimeTaskOwner();
  let form = null,
    formGuard = null,
    releaseForm = () => {};
  function active() {
    return work.isActive() && isActive();
  }
  function current(guard) {
    if (!active() || !guard) return false;
    try {
      guard();
      return true;
    } catch {
      return false;
    }
  }
  function bind() {
    releaseForm();
    releaseForm = () => {};
    form = document.getElementById('ordersBankCredentialsForm');
    formGuard = null;
    if (!active() || !form) return;
    try {
      formGuard = controller.captureBankConnection();
    } catch {
      return;
    }
    const bound = form,
      submit = (event) => event.preventDefault();
    bound.addEventListener('submit', submit);
    releaseForm = () => bound.removeEventListener('submit', submit);
  }
  function currentForm(bound, guard) {
    return (
      bound && document.getElementById('ordersBankCredentialsForm') === bound && current(guard)
    );
  }
  async function saveBankToken() {
    if (!active()) return false;
    const input = document.getElementById('ordersBankBridgeToken');
    if (!input) return false;
    const value =
      input.value === '••••••••'
        ? controller.snapshot().bridgeTokenConfigured
          ? '__KEEP__'
          : ''
        : input.value || '';
    if (value === '__KEEP__') return false;
    await controller.saveBridgeToken(value);
    if (active() && document.getElementById('ordersBankBridgeToken') === input) render();
    return true;
  }
  async function configureBank() {
    const bound = form,
      guard = formGuard;
    if (!currentForm(bound, guard)) return false;
    const value = (id) => bound.querySelector('#' + id)?.value;
    const saved = await controller.configureBankBridge({
      userCode: value('ordersBankUserCode'),
      password: value('ordersBankPassword'),
      businessBranchNumber: value('ordersBusinessBranch'),
      businessAccountNumber: value('ordersBusinessAccount'),
      homeBranchNumber: value('ordersHomeBranch'),
      homeAccountNumber: value('ordersHomeAccount'),
    });
    if (currentForm(bound, guard)) render();
    return saved;
  }
  async function selectBankAccount(role, branch, account) {
    let guard;
    try {
      guard = controller.captureBankConnection();
    } catch {
      return false;
    }
    const selected = await controller.selectBankBridgeAccount(role, branch, account);
    if (current(guard)) render();
    return selected;
  }
  async function deleteBankCredentials() {
    let guard;
    try {
      guard = controller.captureBankConnection();
    } catch {
      return false;
    }
    if (
      !(await confirmDialog(
        'מחיקת חיבור לבנק',
        'למחוק מהמחשב את פרטי ההתחברות המוצפנים לבנק הפועלים? נתוני הבנק שכבר נשמרו בענן לא יימחקו.',
        { confirmText: 'מחק חיבור' }
      ))
    )
      return false;
    if (!current(guard)) return false;
    const deleted = await controller.deleteBankBridgeCredentials();
    if (current(guard)) render();
    return deleted;
  }
  async function exportBankChequeDiagnostics() {
    return controller.exportBankChequeDiagnostics();
  }
  const owned =
    (command) =>
    (...args) =>
      active() ? work.run(() => command(...args)) : Promise.resolve(false);
  return {
    bind,
    saveBankToken: owned(saveBankToken),
    configureBank: owned(configureBank),
    selectBankAccount: owned(selectBankAccount),
    deleteBankCredentials: owned(deleteBankCredentials),
    exportBankChequeDiagnostics: owned(exportBankChequeDiagnostics),
    runtime: {
      isPending: work.isPending,
      drain: work.drain,
      dispose: () => {
        if (!work.close()) return false;
        releaseForm();
        releaseForm = () => {};
        form = null;
        formGuard = null;
        return true;
      },
    },
  };
}
