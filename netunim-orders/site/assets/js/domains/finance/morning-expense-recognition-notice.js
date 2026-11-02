const messages={multiple_invoices:'זוהו כמה חשבוניות ב־PDF. יש לבדוק את הפירוט ולפצל לפני שמירה.',
  unknown_supplier:'הספק או תבנית החשבונית לא זוהו. יש לבחור ספק ולהשלים את הפרטים ידנית.',
  no_usable_text:'אין ב־PDF טקסט שניתן לזהות. יש להשלים את הפרטים ידנית לפי המקור.',
  extraction_error:'קריאת ה־PDF נכשלה. יש לנסות שוב או להשלים את הפרטים ידנית.'};

export function announceExpenseRecognition(host,outcome,toast){
  const message=messages[outcome];if(!message)return false;
  toast(message);
  const notice=host?.querySelector('[data-expense-local]');if(!notice)return true;
  const rect=notice.getBoundingClientRect();
  const scroller=notice.closest('.view-scroll'),visible=scroller?.getBoundingClientRect();
  const top=Math.max(0,visible?.top||0),bottom=Math.min(globalThis.innerHeight,visible?.bottom||globalThis.innerHeight);
  if(rect.top<top||rect.bottom>bottom)notice.scrollIntoView({block:'start',behavior:'instant'});
  return true;
}

export function expenseRecognitionReady(host,{outcome,focus,toast,advance,review}){
  const announced=announceExpenseRecognition(host,outcome,toast);
  if(focus&&!host?.contains(document.activeElement))review.focus({preventScroll:true});
  if(advance&&!announced)toast(outcome==='recognized'?'ה־PDF הבא זוהה ומוכן לבדיקה.':'ה־PDF הבא נטען. יש לבדוק ולהשלים את השדות המסומנים.');
  return announced||advance;
}
