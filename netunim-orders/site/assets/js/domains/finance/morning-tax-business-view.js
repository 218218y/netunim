import {displayDate, esc, money} from '../../shared/tax-calculator/view.js';
import {FIRST_MORNING_TAX_YEAR} from '../../shared/tax-calculator/contracts.js';

const monthLabel = new Intl.DateTimeFormat('he-IL', {month:'long', timeZone:'UTC'});
export function morningBusinessMarkup({selection, report, busy, message, today, result}) {
  const currentYear = Number(today.slice(0, 4)), currentMonth = Number(today.slice(5, 7));
  const months = selection?.year === currentYear ? currentMonth : 12;
  const monthly = selection?.mode === 'monthly';
  return `<div class="tax-morning">
    <div class="tax-morning-source" role="group" aria-label="מקור נתוני העסק">
      <button type="button" id="tax-business-manual" class="btn" data-action="tax-business-source" data-click-arg0="manual" aria-pressed="${!selection}">הזנה ידנית</button>
      <button type="button" id="tax-business-morning" class="btn" data-action="tax-business-source" data-click-arg0="morning" aria-pressed="${!!selection}">חישוב מ־Morning</button>
    </div>
    ${selection ? `<div class="tax-fields">
      <label class="tax-field">שנת נתוני Morning
        <select id="tax-morning-year" data-change="tax-morning-selection" data-morning-key="year">
          ${Array.from({length:currentYear - FIRST_MORNING_TAX_YEAR + 1}, (_, index) => {
            const year = FIRST_MORNING_TAX_YEAR + index;
            return `<option value="${year}" ${year === selection.year ? 'selected' : ''}>${year}</option>`;
          }).join('')}
        </select>
      </label>
      <label class="tax-field">תקופה לחישוב
        <select id="tax-morning-mode" data-change="tax-morning-selection" data-morning-key="mode">
          <option value="annual" ${monthly ? '' : 'selected'} ${selection.year === currentYear ? 'disabled' : ''}>שנה מלאה</option>
          <option value="monthly" ${monthly ? 'selected' : ''}>ממוצע חודשי</option>
        </select>
      </label>
    </div>
    ${monthly ? `<fieldset class="tax-morning-months"><legend>חודשים לחישוב</legend>
      <div>${Array.from({length:months}, (_, index) => {
        const month = index + 1, partial = selection.year === currentYear && month === currentMonth;
        return `<label><input type="checkbox" id="tax-morning-month-${month}" value="${month}" data-change="tax-morning-selection"
          data-morning-key="month" ${selection.months.includes(month) ? 'checked' : ''}>${monthLabel.format(new Date(Date.UTC(selection.year, index, 1)))}${partial ? ' (עד היום)' : ''}</label>`;
      }).join('')}</div></fieldset>` : ''}
    <div class="tax-morning-actions">
      <button type="button" class="btn primary" data-action="tax-morning-load" ${busy || monthly && !selection.months.length ? 'disabled' : ''}>${busy ? 'קורא נתונים…' : 'חשב רווח מ־Morning'}</button>
      ${busy ? '<button type="button" class="btn" data-action="tax-morning-cancel">בטל קריאה</button>' : ''}
    </div>
    <p class="tax-morning-status" role="status">${esc(message)}</p>
    ${report && result ? `<div class="tax-morning-result"><span>${monthly ? 'רווח חודשי ממוצע' : 'רווח שנתי'} לפי Morning · ${selection.year}${report.environment === 'sandbox' ? ' · Sandbox' : ''}</span>
      <strong>${money(monthly ? result.monthly.profit : result.annual.profit)}</strong>${monthly ? `<span>${report.monthCount} חודשים נבחרים · בחישוב השנתי הממוצע מוכפל ב־12</span>` : ''}${report.partialThrough ? `<span>נתונים עד ${esc(displayDate(report.partialThrough))}</span>` : ''}
    </div>` : ''}
    <p>הרווח הניהולי משמש לאומדן המס בחישוב הנוכחי. נתוני ההזנה הידנית נשמרים בנפרד.</p>` : ''}
  </div>`;
}
