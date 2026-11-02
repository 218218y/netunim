// Validation feedback is independent of PDF recognition (yellow suggestions).
export function updateExpenseValidation(host, issues) {
  if (!host) return;
  const messages = new Map();
  for (const issue of issues) for (const name of issue.fields) {
    const values = messages.get(name) || [];
    if (!values.includes(issue.message)) values.push(issue.message);
    messages.set(name, values);
  }
  for (const field of host.querySelectorAll('[data-expense-field], .morning-expense-date input:not([type="hidden"])')) {
    const name = field.dataset.datePart ? 'date' : field.dataset.expenseField === 'supplierQuery' ? 'supplierId' : field.dataset.expenseField;
    const invalid = messages.has(name);
    if (invalid) field.setAttribute('aria-invalid', 'true'); else field.removeAttribute('aria-invalid');
    const id = `expense-error-${name}`;
    const descriptions = (field.getAttribute('aria-describedby') || '').split(' ').filter(value => value && !value.startsWith('expense-error-'));
    if (invalid) descriptions.push(id);
    if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' ')); else field.removeAttribute('aria-describedby');
    if (!invalid || host.querySelector(`#${id}`)) continue;
    const target = name === 'date' ? host.querySelector('.morning-expense-date') : field.closest('label');
    if (!target) continue;
    const error = document.createElement('small');
    error.id = id; error.dataset.expenseError = name; error.className = 'morning-expense-field-error';
    target.append(error);
  }
  for (const error of host.querySelectorAll('[data-expense-error]')) {
    const values = messages.get(error.dataset.expenseError);
    if (values) error.textContent = values.join(' '); else error.remove();
  }
  const summary = host.querySelector('[data-expense-approval-problem]');
  if (summary) {summary.textContent = issues.map(issue => issue.message).join(' '); summary.hidden = !issues.length;}
}
