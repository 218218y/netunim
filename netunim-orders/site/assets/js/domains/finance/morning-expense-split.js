export async function prepareExpenseSplit({source,plan,files,confirmDialog,check,prepareQueue,existing}) {
  const approved=await confirmDialog('פיצול PDF לכמה חשבוניות',
    `נמצאו ${plan.pages.length} עמודים עם מספרי חשבוניות שונים. הקובץ יפוצל מקומית, וכל חלק ייבדק מחדש וייכנס לתור. פרטי הטופס הנוכחי יוחלפו; לא תישמר ולא תישלח הוצאה בשלב זה.`,{confirmText:'פיצול והכנה לבדיקה'});
  check();if(!approved)return null;
  const split=await files.split(source.file,plan.pages.map(row=>row.page),{check});check();
  if(!Array.isArray(split)||split.length!==plan.pages.length)throw Error('הפיצול לא החזיר את כל החשבוניות. המקור נשאר בתור.');
  // Keep the original until every output has been read and its identity checked.
  for(let index=0;index<split.length;index++){
    const extracted=await files.extract(split[index],{check});check();
    const recognized=await files.recognize(extracted);check();
    if(extracted.pages.length!==1||recognized.documents?.blocked||recognized.fields.invoiceNumber.rawNumber!==plan.pages[index].number||recognized.fields.documentType.value!==plan.pages[index].documentType)throw Error('לא ניתן לאמת את כל חלקי הפיצול. המקור נשאר בתור; יש לפצל ידנית.');
  }
  const prepared=await prepareQueue(split,existing,check);check();return prepared;
}
