export function mountBridgePairing(form, {bank, documentBridge}) {
  const code = form.querySelector('#pairCode');
  const bridge = form.querySelector('#pairBridge');
  const button = form.querySelector('button[type=submit]');
  const message = form.querySelector('[role=status]');
  let disposed = false;
  let pending = false;
  let generation = 0;
  button.disabled = false;

  async function submit(event) {
    event.preventDefault();
    if (pending || disposed) return;
    const value = code.value.trim();
    code.value = '';
    if (!/^ntp1\.[A-Za-z0-9_-]{43}$/.test(value)) {
      message.textContent = 'יש להדביק קוד הצמדה חד־פעמי שנוצר במחבר המקומי.';
      return;
    }
    const client = bridge.value === 'bank' ? bank : documentBridge;
    const current = generation;
    pending = true;
    button.disabled = true;
    bridge.disabled = true;
    message.textContent = 'בודק את קוד ההצמדה במחבר המקומי…';
    try {
      const before = client.get();
      const receipt = await client.redeem(value);
      if (disposed || generation !== current) return;
      if (receipt?.ok !== true || typeof receipt.token !== 'string' || !/^ntk1\.[A-Za-z0-9_-]{43}$/.test(receipt.token)) {
        throw Error('invalid pairing receipt');
      }
      if (client.get() !== before) {
        message.textContent = 'ההצמדה בדפדפן השתנתה בזמן הבקשה. יש לפתוח שוב את דף האבטחה ולהפיק קוד חדש.';
        return;
      }
      client.set(receipt.token);
      message.textContent = 'המחבר הוצמד לאתר הזה. אפשר לחזור למערכת.';
    } catch {
      if (!disposed && generation === current) message.textContent = 'ההצמדה לא הושלמה. יש לבדוק את המחבר, כתובת האתר ותוקף הקוד, ואז להפיק קוד חדש.';
    } finally {
      pending = false;
      if (!disposed) {
        button.disabled = false;
        bridge.disabled = false;
      }
    }
  }

  form.addEventListener('submit', submit);
  window.addEventListener('pagehide', event => {
    if (!event.persisted) disposed = true;
    generation++;
    code.value = '';
  });
}
