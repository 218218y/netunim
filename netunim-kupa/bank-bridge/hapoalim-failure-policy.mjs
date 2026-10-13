// @ts-nocheck

export function scraperFailureMessage(result) {
  const type = String(result?.errorType || '').toUpperCase();
  const raw = String(result?.errorMessage || '').trim();
  if (raw.includes('NETUNIM_INTERACTIVE_AUTH_TIMEOUT'))
    return [
      'זמן האימות בבנק הסתיים. פתח שוב אימות בבנק והשלם את הקוד בתוך 10 דקות',
      'INTERACTIVE_AUTH_TIMEOUT',
    ];
  if (raw.includes('NETUNIM_SILENT_AUTH_TIMEOUT'))
    return [
      'לא נמצא סשן בנק פעיל ברענון השקט. לחץ „פתח אימות בבנק” פעם אחת כדי לחדש את ההזדהות.',
      'AUTH_REQUIRED',
    ];
  if (raw.includes('NETUNIM_INTERACTIVE_BROWSER_CLOSED'))
    return ['חלון האימות בבנק נסגר לפני שההתחברות הושלמה', 'INTERACTIVE_BROWSER_CLOSED'];
  if (type === 'INVALID_PASSWORD')
    return ['פרטי ההתחברות לבנק הפועלים אינם נכונים', 'INVALID_PASSWORD'];
  if (type === 'CHANGE_PASSWORD')
    return ['בנק הפועלים דורש החלפת סיסמה לפני שניתן להמשיך', 'CHANGE_PASSWORD'];
  if (type === 'ACCOUNT_BLOCKED')
    return [
      'הגישה לחשבון נחסמה בבנק הפועלים. יש להיכנס לאתר הבנק ולבדוק את החשבון',
      'ACCOUNT_BLOCKED',
    ];
  if (type === 'TIMEOUT')
    return [
      'הכניסה לבנק הפועלים לא הסתיימה בזמן. ברענון ידני נסה להשלים אימות בחלון הבנק',
      'TIMEOUT',
    ];
  return [raw ? `החיבור לבנק הפועלים נכשל: ${raw}` : 'החיבור לבנק הפועלים נכשל', 'SCRAPE_FAILED'];
}
