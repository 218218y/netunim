export const MORNING_DOCUMENT_TYPES=Object.freeze({
  10:'הצעת מחיר',20:'הזמנה / אישור הזמנה',100:'הזמנה',200:'תעודת משלוח',210:'תעודת החזרה',300:'חשבון עסקה',
  305:'חשבונית מס',320:'חשבונית מס / קבלה',330:'חשבונית זיכוי',400:'קבלה',405:'קבלה על תרומה',410:'קבלת פיקדון',
  500:'תעודת חיוב',600:'הזמנת רכש',610:'הצעת רכש'
});

export function morningDocumentTypeLabel(type,fallback='מסמך Morning'){
  return MORNING_DOCUMENT_TYPES[Number(type)]||fallback;
}

export function morningDocumentLabel(value={},fallback='מסמך Morning'){
  const type=value?.documentType??value?.type,number=String(value?.documentNumber??value?.number??'').trim();
  const label=morningDocumentTypeLabel(type,fallback);
  return `${label}${number?` ${number}`:''}`;
}
