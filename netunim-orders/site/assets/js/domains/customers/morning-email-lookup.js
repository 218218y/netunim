const sourceLabels = {contacts: 'אנשי קשר', other: 'אנשי קשר אחרים'};
// Both Google search endpoints update their caches lazily after an empty query.
const warmupDelayMs = 4000;
const warmupReuseMs = 30_000;
const searchErrors = {
  contacts_not_configured: 'חיבור לאנשי הקשר של Google עדיין אינו זמין במערכת.',
  contacts_cloud_auth_required: 'כדי לחפש באנשי הקשר יש להתחבר לענן עם אימות דו־שלבי.',
  contacts_search_limit: 'בוצעו הרבה חיפושים. אפשר לנסות שוב בעוד דקה.',
  contacts_invalid_search: 'יש להזין שם, כתובת או מספר טלפון בשורה אחת.',
};

function gmailUrl(query, account) {
  const url = new URL(account ? 'https://mail.google.com/mail/u/' : 'https://mail.google.com/mail/u/0/');
  if (account) url.searchParams.set('authuser', account);
  if (query) url.hash = `search/${encodeURIComponent(query.toWellFormed())}`;
  return url.href;
}

function message(error) {
  return searchErrors[error?.code] || 'החיבור ל־Google אינו זמין כרגע. אפשר לנסות שוב או להזין כתובת ידנית.';
}

function wait(ms, signal) {
  signal.throwIfAborted();
  if (ms <= 0) return;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    function cancel() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener('abort', cancel, {once: true});
  });
}

export function createMorningEmailLookup({request, session, field, canEdit}) {
  let closeActive, prepared;

  function toggle(button) {
    const panel = field('morningEmailLookup'), target = field('morningClientEmail');
    if (!panel || !target || button !== field('morningEmailLookupToggle')) return;
    if (!panel.hidden) { closeActive?.(button); return; }
    if (!canEdit()) return;
    closeActive?.();
    const generation = session.generation, modalSignal = session.signal;
    const lifetime = new AbortController();
    const current = () => !lifetime.signal.aborted && session.isActive(generation);
    const available = () => current() && canEdit();
    const {ownerDocument: doc} = panel;
    const control = key => panel.querySelector(`[data-email-${key}]`);
    const query = control('query'), gmail = control('gmail'), status = control('status'), results = control('results');
    const account = control('account'), connect = control('connect'), disconnect = control('disconnect');
    const refresh = control('refresh'), continueLink = control('authorize'), closeButton = control('close');
    const retry = control('retry');
    let connection = {}, preparing, searchRequest, retryAction, busy = false, oauthPending = false;

    const say = text => { status.textContent = text; };
    const listen = (element, type, fn) => element.addEventListener(type, fn, {signal: lifetime.signal});
    const observer = new MutationObserver(() => { if (!current()) close(); });
    observer.observe(panel.closest('#modal'), {childList: true});
    observer.observe(doc.getElementById('modalBackdrop'), {attributes: true, attributeFilter: ['class']});

    function clearSearch() {
      searchRequest?.abort();
      results.replaceChildren();
      offerRetry();
    }

    function offerRetry(action) {
      retryAction = action;
      retry.hidden = !action;
    }

    function close(focus) {
      if (lifetime.signal.aborted) return;
      observer.disconnect();
      modalSignal.removeEventListener('abort', closeFromOwner);
      lifetime.abort();
      clearSearch();
      panel.hidden = true;
      account.textContent = '';
      query.value = '';
      continueLink.removeAttribute('href');
      gmail.removeAttribute('href');
      button.setAttribute('aria-expanded', 'false');
      if (focus?.isConnected && session.isActive(generation)) focus.focus();
      if (closeActive === close) closeActive = undefined;
    }

    function closeFromOwner() { close(); }

    function renderConnection() {
      account.textContent = connection.account || '';
      connect.hidden = !connection.available;
      connect.textContent = connection.reconnect ? 'חבר מחדש את Google' : connection.grant ? 'החלף חשבון Google' : 'חבר את אנשי הקשר של Google';
      disconnect.hidden = !connection.grant;
      connect.disabled = disconnect.disabled = refresh.disabled = retry.disabled = busy;
      gmail.href = gmailUrl(query.value.trim(), connection.account);
    }

    function connectionError(error, tryAgain) {
      if (error?.code === 'contacts_reconnect_required') {
        prepared = undefined;
        clearSearch();
        connection.reconnect = true;
        renderConnection();
        say('פג תוקף ההרשאה לאנשי הקשר. יש לחבר את חשבון Google מחדש.');
        return;
      }
      say(message(error));
      offerRetry(tryAgain);
    }

    function renderMatches(data) {
      const rows = Array.isArray(data.results) ? data.results : [];
      for (const row of rows) {
        if (typeof row?.email !== 'string' || row.email.length > target.maxLength || !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/u.test(row.email)) continue;
        const item = doc.createElement('li'), pick = doc.createElement('button');
        const name = doc.createElement('bdi'), email = doc.createElement('bdi'), source = doc.createElement('small');
        pick.type = 'button';
        pick.className = 'btn morning-email-result';
        name.textContent = typeof row.name === 'string' ? row.name : '';
        email.dir = 'ltr';
        email.textContent = row.email;
        source.textContent = (Array.isArray(row.sources) ? row.sources : []).filter(key => Object.hasOwn(sourceLabels, key)).map(key => sourceLabels[key]).join(' · ');
        if (name.textContent) pick.append(name);
        pick.append(email, source);
        item.append(pick);
        results.append(item);
        listen(pick, 'click', () => void choose(row.email));
      }
      const count = results.children.length;
      const missing = Object.keys(sourceLabels).filter(source => data.missing?.includes(source));
      if (missing.length) {
        const checked = Object.keys(sourceLabels).filter(source => !missing.includes(source)).map(source => `„${sourceLabels[source]}”`).join(' ו־');
        const unavailable = missing.map(source => `„${sourceLabels[source]}”`).join(' ו־');
        const outcome = count ? `נמצאו ${count} כתובות במקור ${checked}.` : `לא נמצאו כתובות במקור ${checked}.`;
        say(`${outcome} החיפוש במקור ${unavailable} נכשל. נסו שוב כדי לבדוק גם אותו.`);
        offerRetry(scheduleSearch);
        return;
      }
      say(count ? `נמצאו ${count} כתובות לבחירה.` : 'לא נמצאו כתובות בשני מקורות Google. נסו תחילת שם או כתובת, או חפשו ב־Gmail.');
    }

    async function choose(email) {
      if (!available() || busy || !connection.grant) return;
      const oldEmail = target.value, oldQuery = query.value, grant = connection.grant;
      let refreshNeeded = false, connectionUpdated = false;
      busy = true;
      renderConnection();
      say('מאמת את החיבור לפני בחירת הכתובת…');
      try {
        const data = await request('status', {}, lifetime.signal);
        if (!available()) return;
        if (data.grant !== grant || data.reconnect) {
          clearSearch();
          acceptConnection(data);
          connectionUpdated = true;
          return;
        }
        if (query.value !== oldQuery) return;
        if (target.value !== oldEmail) { say('כתובת הנמען נערכה במקביל. בחרו שוב כדי להחליף אותה.'); return; }
        target.value = email;
        target.dispatchEvent(new Event('input', {bubbles: true}));
        target.dispatchEvent(new Event('change', {bubbles: true}));
        close(target);
      } catch (error) {
        if (!available()) return;
        if (error?.code === 'contacts_connection_changed') {
          clearSearch();
          refreshNeeded = true;
        } else connectionError(error, () => void choose(email));
      } finally {
        busy = false;
        if (current()) renderConnection();
        if (available() && refreshNeeded) void readConnection();
        else if (available() && (connectionUpdated || query.value !== oldQuery)) void scheduleSearch();
      }
    }

    function prepare(grant) {
      if (prepared?.grant === grant && performance.now() < prepared.expiresAt) return prepared.readyAt;
      if (preparing?.grant === grant) return preparing.promise;
      const flight = {grant};
      preparing = flight;
      flight.promise = request('prepare', {grant}, lifetime.signal).then(data => {
        const readyAt = performance.now() + warmupDelayMs;
        if (current() && connection.grant === grant && !connection.reconnect && !data.missing?.length) {
          prepared = {grant, readyAt, expiresAt: readyAt + warmupReuseMs};
        }
        return readyAt;
      }).finally(() => { if (preparing === flight) preparing = undefined; });
      return flight.promise;
    }

    async function scheduleSearch() {
      clearSearch();
      renderConnection();
      if (!available() || busy || !connection.available) return;
      if (connection.reconnect) { connectionError({code: 'contacts_reconnect_required'}); return; }
      const term = query.value.trim(), grant = connection.grant;
      if (!grant) { say('חברו את Google כדי לחפש באנשי קשר ובאנשי קשר אחרים.'); return; }
      const controller = searchRequest = new AbortController();
      const activeSearch = () => available() && !controller.signal.aborted;
      const canSearch = term.length >= 2;
      say(canSearch ? 'מחפש כתובות ב־Google…' : 'הקלידו לפחות שני תווים.');
      try {
        const [readyAt] = await Promise.all([prepare(grant), canSearch && wait(350, controller.signal)]);
        if (!canSearch || !activeSearch()) return;
        await wait(readyAt - performance.now(), controller.signal);
        const data = await request('search', {query: term, grant}, controller.signal);
        if (activeSearch() && data.grant === grant) renderMatches(data);
      } catch (error) {
        if (!activeSearch()) return;
        if (error?.code === 'contacts_connection_changed') void readConnection();
        else connectionError(error, scheduleSearch);
      }
    }

    function acceptConnection(data) {
      if (prepared && (prepared.grant !== data.grant || data.reconnect)) prepared = undefined;
      connection = {...data, available: true};
    }

    async function manage(action) {
      if (!available() || busy) return;
      busy = true;
      oauthPending = false;
      clearSearch();
      renderConnection();
      continueLink.hidden = true;
      continueLink.removeAttribute('href');
      say(action === 'start' ? 'מכין את החיבור ל־Google…' : 'בודק חיבור ל־Google…');
      try {
        const data = await request(action, {}, lifetime.signal);
        if (!available()) return;
        if (action === 'start') {
          const url = new URL(data.authorize_url);
          if (url.origin !== 'https://accounts.google.com' || url.pathname !== '/o/oauth2/v2/auth') throw new Error('invalid_authorization_url');
          continueLink.href = url.href;
          continueLink.hidden = false;
          say('פתחו את Google בלשונית חדשה. בסיום חזרו לכאן ולחצו על „בדוק חיבור”.');
          continueLink.focus();
          return;
        }
        acceptConnection(data);
      } catch (error) {
        if (available()) connectionError(error, () => void manage(action));
        return;
      } finally {
        busy = false;
        if (current()) renderConnection();
      }
      if (available()) void scheduleSearch();
    }

    function readConnection() { return manage('status'); }

    closeActive = close;
    modalSignal.addEventListener('abort', closeFromOwner, {once: true});
    listen(query, 'input', scheduleSearch);
    listen(closeButton, 'click', () => close(button));
    listen(panel, 'keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(button);
      }
    });
    listen(refresh, 'click', () => void readConnection());
    listen(retry, 'click', () => retryAction?.());
    listen(continueLink, 'click', () => { oauthPending = true; });
    listen(doc, 'visibilitychange', () => { if (!doc.hidden && oauthPending && !busy) void readConnection(); });
    listen(connect, 'click', () => void manage('start'));
    listen(disconnect, 'click', () => void manage('disconnect'));
    query.value = (field('morningClientName')?.value.trim() || target.value.trim()).slice(0, query.maxLength);
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    query.focus();
    void readConnection();
  }

  return {toggle};
}
