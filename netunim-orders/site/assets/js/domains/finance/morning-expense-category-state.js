import {expensePreferredCategory,resolveExpenseSupplierCategory,readExpenseCatalogPage,expenseCatalogClassifications} from './morning-expense-catalog.js';

export function expenseCategoryRows(catalog,retained){
  // Canonical detail evidence supersedes an earlier search snapshot of the
  // same expense, including its classification and supplier identity.
  return [...new Map([...(catalog?.expenses||[]),...retained].map(row=>[row.id,row])).values()];
}
export function retainExpenseCategoryEvidence(catalog,retained,rows){
  const merged=[...new Map([...retained,...rows].map(row=>[row.id,row])).values()];
  catalog.classifications=expenseCatalogClassifications(expenseCategoryRows(catalog,merged));
  return merged;
}

export async function readRetainedExpenseCategory(id, canonicalItem, check, environment) {
  if (!id) return null;
  try {
    const item = await canonicalItem('get_expense',id,check,environment);
    return item.kind === 'expense' && item.status !== 100 && item.classification?.id ? item : null;
  } catch {check();return null;}
}
export async function readSavedExpenseCategory({supplier,capabilities,expenses,preferences,request,canonicalItem,check}) {
  const preferred=expensePreferredCategory(expenses,supplier,capabilities);
  const saved=!preferred.required&&preferences?.classifications.find(row=>row.supplierId===supplier.id);
  if(!saved)return resolveExpenseSupplierCategory(request,capabilities,supplier,expenses,check);
  let item=expenses.find(row=>row.id===saved.expenseId);
  if(!item){
    try{item=await canonicalItem('get_expense',saved.expenseId,check);}
    catch{check();return {unavailable:true,message:'לא ניתן לאמת כעת את הסיווג השמור. אפשר לבחור סיווג מההצעות ולנסות שוב בהמשך.'};}
  }
  check();
  if(item?.id!==saved.expenseId||item.kind!=='expense'||item.status===100||!item.classification?.id)return {forget:true,category:null,rows:[],message:'הסיווג השמור אינו זמין לאימות. יש לבחור סיווג מההצעות.'};
  return {category:item,rows:[item],message:'הסיווג ששימש אותך אומת מחדש מול Morning ומוצע לבחירתך.'};
}
export async function readMoreExpenseClassifications(request,catalog,check) {
  const page=catalog.expensePage.page+1;
  if(page>=catalog.expensePage.pages||page>=20)return null;
  const value=await readExpenseCatalogPage(request,catalog.capabilities,'expenses',{fromDate:catalog.fromDate,toDate:catalog.toDate},page,check);check();
  const seen=new Set(catalog.expenses.map(row=>row.id));
  if(value.total!==catalog.expensePage.total||value.items.some(row=>seen.has(row.id)))throw Error('רשימת ההוצאות השתנתה. יש לרענן את ההצעות.');
  return value;
}
