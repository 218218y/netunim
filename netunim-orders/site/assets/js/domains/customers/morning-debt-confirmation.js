// @ts-check
/** @typedef {{applyPayment:boolean,applyInvoice:boolean}} AllocationPolicy */
/** @typedef {{eligible:boolean,relation:string,documentAmount:number,targetMagnitude:number,paymentAffected:boolean,invoiceAffected:boolean,paymentBefore:number,invoiceBefore:number,paymentSupported:boolean,invoiceSupported:boolean,paymentApply:number,invoiceApply:number,paymentRemainingBefore:number,invoiceRemainingBefore:number,paymentRemainingAfter:number,invoiceRemainingAfter:number,paymentCompleteBefore:boolean,invoiceCompleteBefore:boolean,paymentUnapplied:number,invoiceUnapplied:number}} DebtImpact */
/** @param {{format:{money:(value:number)=>string},financial:{impact:(debt:unknown,type:number,amount:number,policy:AllocationPolicy)=>DebtImpact}}} ports
 * @returns {{message:(debtId:string,debt:unknown,type:number,amount:number,policy:AllocationPolicy)=>string}}
 */
export function createMorningDebtConfirmation({
  format: { money },
  financial: { impact: morningDebtImpact }
}) {
  /** @param {string} label @param {boolean} supported @param {boolean} affected @param {number} apply @param {number} remainingBefore @param {number} remainingAfter @param {boolean} completeBefore @param {number} unapplied */
  function impactLine(
    label,
    supported,
    affected,
    apply,
    remainingBefore,
    remainingAfter,
    completeBefore,
    unapplied
  ) {
    if (!supported)
      return `${label}: סוג המסמך הזה אינו משנה את הצד הזה של החוב.`;
    if (!affected)
      return `${label}: לא יעודכן — ביטלת את הזקיפה לחוב עבור המסמך הזה.`;
    if (completeBefore)
      return `${label}: כבר הושלם בחוב; המסמך לא יוסיף סכום נוסף.`;
    const appliedText = apply > 0 ? `יירשמו ${money(apply)}` : 'לא יירשם סכום';
    const remainingText =
      remainingAfter <= 0
        ? 'והמצב ייסגר במלואו'
        : `ויישארו ${money(remainingAfter)}`;
    return `${label}: ${appliedText} ${remainingText}.${unapplied > 0 ? ` ${money(unapplied)} מסכום המסמך לא ייזקפו לצד הזה של החוב, כי היתרה לפני ההפקה היא ${money(remainingBefore)}.` : ''}`;
  }
  /** @param {string} activeDebtId @param {unknown} debt @param {number} type @param {number} amount @param {AllocationPolicy} policy */
  function debtImpactConfirmation(activeDebtId, debt, type, amount, policy) {
    if (!activeDebtId) return '';
    if (!debt)
      return '\n\n⚠ שורת החוב שממנה נפתח המסמך כבר אינה קיימת. המסמך יופק ב-Morning אך לא יעדכן חוב מקומי.';
    const impact = morningDebtImpact(debt, type, amount, policy),
      lines = [];
    if (!impact.eligible)
      return '\n\n⚠ החוב אינו חוב חיובי פעיל, ולכן המסמך לא יעדכן אוטומטית את מצב התשלום או החשבונית.';
    if (impact.paymentAffected || impact.invoiceAffected)
      lines.push(
        '⚠ הזקיפה למסמך היא שינוי נוסף בחוב המקומי. אם כבר רשמת ידנית את אותו תשלום/חשבונית או הקטנת את סכום החוב בגללם, חזור ובטל את הסימון המתאים כדי למנוע קיזוז כפול.'
      );
    if (impact.paymentAffected && impact.paymentBefore > 0)
      lines.push(
        `⚠ בחוב כבר רשום תשלום בסך ${money(impact.paymentBefore)}. אם המסמך הנוכחי מתעד את אותו תשלום שכבר נרשם, חזור ובטל „זקוף כתשלום לחוב”.`
      );
    if (impact.invoiceAffected && impact.invoiceBefore > 0)
      lines.push(
        `⚠ בחוב כבר רשום סכום חשבוניות בסך ${money(impact.invoiceBefore)}. אם המסמך הנוכחי מתעד חשבונית שכבר נרשמה, חזור ובטל „זקוף כחשבונית לחוב”.`
      );
    if (impact.relation === 'over')
      lines.push(
        `⚠ סכום המסמך ${money(impact.documentAmount)} גבוה מסכום החוב ${money(impact.targetMagnitude)}. ההפרש לא ייזקף לחוב זה.`
      );
    else if (impact.relation === 'partial')
      lines.push(
        `המסמך חלקי ביחס לחוב: ${money(impact.documentAmount)} מתוך ${money(impact.targetMagnitude)}.`
      );
    lines.push(
      impactLine(
        'תשלום',
        impact.paymentSupported,
        impact.paymentAffected,
        impact.paymentApply,
        impact.paymentRemainingBefore,
        impact.paymentRemainingAfter,
        impact.paymentCompleteBefore,
        impact.paymentUnapplied
      )
    );
    lines.push(
      impactLine(
        'חשבונית',
        impact.invoiceSupported,
        impact.invoiceAffected,
        impact.invoiceApply,
        impact.invoiceRemainingBefore,
        impact.invoiceRemainingAfter,
        impact.invoiceCompleteBefore,
        impact.invoiceUnapplied
      )
    );
    if (!impact.paymentAffected && !impact.invoiceAffected)
      lines.push('לפי הבחירה שלך, המסמך לא ישנה כלל את החוב המקומי.');
    else
      lines.push(
        'רק הסעיפים שסומנו יעודכנו, ורק לאחר אימות ודאי של המסמך ב-Morning.'
      );
    return `\n\nעדכון החוב לאחר אימות:\n${lines.join('\n')}`;
  }
  return { message: debtImpactConfirmation };
}
