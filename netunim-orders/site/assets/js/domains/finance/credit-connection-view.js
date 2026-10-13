import { esc, uid } from '../../core/values.js';
import { CREDIT_PROVIDER_LABELS } from './credit-feed.js';
import { createRuntimeTaskOwner } from '../../shared/runtime-task-owner.js';

function providerFields(provider) {
  return provider === 'isracard' || provider === 'amex'
    ? ['id', 'card6Digits', 'password']
    : ['username', 'password'];
}

export function createCreditConnectionView({
  controller,
  modal,
  closeModal,
  confirmDialog,
  render,
}) {
  const work = createRuntimeTaskOwner();
  let activeForm = null,
    activeProfileId = '',
    activeConnection = () => {},
    releaseForm = () => {};
  function currentForm(form) {
    const current =
      work.isActive() &&
      activeForm === form &&
      document.getElementById('modalBackdrop')?.classList.contains('open') &&
      document.getElementById('ordersCreditConnectionForm') === form;
    if (!current) return false;
    try {
      activeConnection();
      return true;
    } catch {
      return false;
    }
  }
  function profileForModal(profileId) {
    const s = controller.snapshot(),
      local = (s.creditStatus?.profiles || []).find((profile) => profile.profileId === profileId),
      cloud = s.creditSync.profiles.find((profile) => profile.profileId === profileId);
    return { existing: local || cloud, local: !!local };
  }
  function updateCreditConnectionFields() {
    const provider = document.getElementById('ordersCcProvider')?.value || 'visaCal',
      fields = new Set(providerFields(provider));
    for (const [selector, key] of [
      ['.orders-cc-username', 'username'],
      ['.orders-cc-id', 'id'],
      ['.orders-cc-card6', 'card6Digits'],
    ]) {
      const node = document.querySelector(selector);
      if (node) node.hidden = !fields.has(key);
    }
    const note = document.querySelector('.orders-cc-isracard-note');
    if (note) note.hidden = !(provider === 'isracard' || provider === 'amex');
  }
  function openCreditConnection(profileId = '') {
    if (!work.isActive()) return false;
    releaseForm();
    const assertConnection = controller.captureCreditConnection();
    const { existing, local } = profileForModal(profileId),
      provider = existing?.provider || 'visaCal',
      isEdit = !!existing,
      preserve = local;
    modal(
      isEdit ? 'עריכת חיבור אשראי' : 'חיבור חדש לחברת אשראי',
      `<form id="ordersCreditConnectionForm" class="form-grid credit-connect-grid" autocomplete="off"><div class="field"><label>חברה</label><select id="ordersCcProvider"><option value="visaCal" ${provider === 'visaCal' ? 'selected' : ''}>כאל</option><option value="max" ${provider === 'max' ? 'selected' : ''}>MAX</option><option value="isracard" ${provider === 'isracard' ? 'selected' : ''}>ישראכרט</option><option value="amex" ${provider === 'amex' ? 'selected' : ''}>American Express</option></select></div><div class="field"><label>שם החיבור</label><input id="ordersCcLabel" value="${esc(existing?.label || CREDIT_PROVIDER_LABELS[provider] || '')}"></div><div class="field"><label>בעל החשבון</label><input id="ordersCcOwner" value="${esc(existing?.ownerLabel || '')}"></div><div class="field"><label>ברירת מחדל לכרטיסים</label><select id="ordersCcAccount"><option ${existing?.defaultAccount !== 'ביתי' ? 'selected' : ''}>עסקי</option><option ${existing?.defaultAccount === 'ביתי' ? 'selected' : ''}>ביתי</option></select></div><div class="field orders-cc-username"><label>שם משתמש</label><input id="ordersCcUsername" autocomplete="username" placeholder="${preserve ? 'השאר ריק כדי לא לשנות' : ''}"></div><div class="field orders-cc-id"><label>תעודת זהות</label><input id="ordersCcId" inputmode="numeric" autocomplete="username" placeholder="${preserve ? 'השאר ריק כדי לא לשנות' : ''}"></div><div class="field orders-cc-card6"><label>6 ספרות אחרונות של כרטיס</label><input id="ordersCcCard6" inputmode="numeric" maxlength="6" placeholder="${preserve ? 'השאר ריק כדי לא לשנות' : ''}"></div><div class="field"><label>סיסמה</label><input id="ordersCcPassword" type="password" autocomplete="current-password" placeholder="${preserve ? 'השאר ריק כדי לא לשנות' : ''}"></div><div class="field full"><div class="notice">פרטי ההתחברות נשלחים רק ל‑Bank Bridge המקומי ונשמרים מוצפנים ב‑Windows. הם אינם נשמרים בענן.</div></div><div class="field full orders-cc-isracard-note"><div class="notice">ישראכרט/American Express משתמשים בתעודת זהות, 6 ספרות אחרונות והסיסמה הקבועה.</div></div></form>`,
      `<button class="btn primary" type="button" data-action="save-orders-credit-connection" data-click-arg0="${esc(existing?.profileId || '')}">${isEdit ? 'שמור חיבור' : 'הוסף חיבור'}</button><button class="btn" type="button" data-action="close-modal">ביטול</button>`
    );
    activeForm = document.getElementById('ordersCreditConnectionForm');
    activeConnection = assertConnection;
    activeProfileId = existing?.profileId || '';
    const form = activeForm,
      select = document.getElementById('ordersCcProvider'),
      change = () => {
        if (currentForm(form)) updateCreditConnectionFields();
      },
      submit = (event) => event.preventDefault();
    select?.addEventListener('change', change);
    form?.addEventListener('submit', submit);
    releaseForm = () => {
      select?.removeEventListener('change', change);
      form?.removeEventListener('submit', submit);
    };
    updateCreditConnectionFields();
  }

  async function saveCreditConnection(existingId = '') {
    const form = activeForm;
    if (!form || !currentForm(form) || existingId !== activeProfileId) return false;
    const assertConnection = activeConnection;
    const provider = document.getElementById('ordersCcProvider')?.value || 'visaCal',
      payload = {
        profileId: existingId || uid('CCP'),
        provider,
        label:
          document.getElementById('ordersCcLabel')?.value.trim() ||
          CREDIT_PROVIDER_LABELS[provider] ||
          provider,
        ownerLabel: document.getElementById('ordersCcOwner')?.value.trim() || '',
        defaultAccount:
          document.getElementById('ordersCcAccount')?.value === 'ביתי' ? 'ביתי' : 'עסקי',
        username: document.getElementById('ordersCcUsername')?.value || '',
        id: document.getElementById('ordersCcId')?.value || '',
        card6Digits: document.getElementById('ordersCcCard6')?.value || '',
        password: document.getElementById('ordersCcPassword')?.value || '',
      };
    const saved = await controller.saveCreditProfile(payload);
    if (!work.isActive()) return false;
    try {
      assertConnection();
    } catch {
      return false;
    }
    if (saved === true && currentForm(form)) {
      releaseForm();
      activeForm = null;
      closeModal();
      render();
      return true;
    }
    return false;
  }
  async function deleteCreditConnection(profileId) {
    const assertConnection = controller.captureCreditConnection();
    if (
      !(await confirmDialog(
        'למחוק חיבור מהמחשב?',
        'פרטי ההתחברות המוצפנים יימחקו מהמחשב הזה. נתוני הסנכרון שכבר נשמרו בענן יישארו.',
        { confirmText: 'מחק חיבור' }
      ))
    )
      return;
    if (!work.isActive()) return false;
    try {
      assertConnection();
    } catch {
      return false;
    }
    const deleted = await controller.deleteCreditProfile(profileId);
    if (!work.isActive()) return false;
    try {
      assertConnection();
    } catch {
      return false;
    }
    if (deleted) render();
    return deleted;
  }
  async function resetCreditSync() {
    const assertConnection = controller.captureCreditReset();
    if (!assertConnection) return false;
    if (
      !(await confirmDialog(
        'לאפס את כל סנכרון האשראי?',
        'האיפוס ימחק את חיבורי חברות האשראי המוצפנים מהמחשב הזה וגם את נתוני הסנכרון והשיוכים בענן. תוספות ידניות בקופה יישארו.',
        { confirmText: 'אפס והתחל מחדש' }
      ))
    )
      return;
    if (!work.isActive()) return false;
    try {
      assertConnection();
    } catch {
      return false;
    }
    const reset = await controller.resetCreditSync();
    if (!work.isActive()) return false;
    try {
      assertConnection();
    } catch {
      return false;
    }
    if (reset) render();
    return reset;
  }
  const owned =
    (command) =>
    (...args) =>
      work.isActive() ? work.run(() => command(...args)) : Promise.resolve(false);
  return {
    openCreditConnection,
    saveCreditConnection: owned(saveCreditConnection),
    deleteCreditConnection: owned(deleteCreditConnection),
    resetCreditSync: owned(resetCreditSync),
    runtime: {
      isPending: work.isPending,
      drain: work.drain,
      dispose: () => {
        if (!work.close()) return false;
        releaseForm();
        activeForm = null;
        return true;
      },
    },
  };
}

export function creditMappingRow(model) {
  const { profile, account, mapping } = model,
    included = mapping.included === true,
    hidden = mapping.hidden === true,
    accountClass = mapping.account || profile.defaultAccount || 'עסקי',
    cardName = mapping.cardName || '',
    manualFrame = mapping.manualFrame ?? '',
    issuerFrameAvailable = account.cardFrame !== null || account.availableCredit !== null;
  return `<div class="credit-mapping-row ${included ? 'included' : 'excluded'} ${hidden ? 'hidden-card' : ''}"><label><input type="checkbox" data-change="orders-credit-included" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" ${included ? 'checked' : ''}><span>${included ? 'כלול' : 'לא כלול'}</span></label><label><input type="checkbox" data-change="orders-credit-hidden" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" ${hidden ? 'checked' : ''}><span>${hidden ? 'מוסתר' : 'הסתר'}</span></label><span><b>${esc(CREDIT_PROVIDER_LABELS[profile.provider] || profile.provider)} • ${esc(account.accountNumber || 'כרטיס')}</b><small>${esc(profile.label)}${profile.ownerLabel ? ` · ${esc(profile.ownerLabel)}` : ''}</small></span><select data-change="orders-credit-account" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}"><option ${accountClass === 'עסקי' ? 'selected' : ''}>עסקי</option><option ${accountClass === 'ביתי' ? 'selected' : ''}>ביתי</option></select><input data-change="orders-credit-name" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" value="${esc(cardName)}" placeholder="שם תצוגה (רשות)"><input class="credit-manual-frame" type="number" inputmode="decimal" min="0" step="1" aria-label="מסגרת ידנית" title="${issuerFrameAvailable ? 'לא בשימוש: התקבל נתון מסגרת מהחברה' : 'משמשת רק כאשר חברת האשראי אינה מספקת מסגרת'}" data-change="orders-credit-manual-frame" data-change-arg0="${esc(profile.profileId)}" data-change-arg1="${esc(account.accountNumber)}" value="${esc(manualFrame)}" placeholder="${issuerFrameAvailable ? 'מסגרת מהחברה' : 'מסגרת ידנית'}" ${issuerFrameAvailable ? 'disabled' : ''}></div>`;
}
