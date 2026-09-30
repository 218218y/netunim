import {createSearchFragmentIndex} from '../shared/search-fragments.js';
import {createGlobalDocumentSearch} from '../shared/global-document-search.js';
import {money} from '../core/money.js';
import {buildKupaSearchFragment,KUPA_SEARCH_FRAGMENTS,searchKupaGlobalEntries} from '../domains/search/model.js';
import {checkIsClosedStatus} from '../domains/checks/model.js';

// Kupa owns only its business-data index and navigation. The full-page shell,
// Everything/Drive integration, content modes and document preview are shared
// with Orders in shared/global-document-search.js.
export function createUiGlobalSearch({documentBridge=null,searchRevision,runFinance,model,ui,setPage,confirmDialog=null}){
  let highlightTimer=null;
  const indexedEntries=createSearchFragmentIndex({
    fragments:Object.keys(KUPA_SEARCH_FRAGMENTS),
    revision:name=>name==='notes'&&model.state.notesSheet?null:searchRevision?.(KUPA_SEARCH_FRAGMENTS[name],name),
    build:name=>runFinance(()=>buildKupaSearchFragment(model.state,name)),
  });

  function siteResultMeta(item){
    const parts=[...(item?.meta||[])];
    if(item?.amount!==undefined&&item?.amount!==null&&Number.isFinite(Number(item.amount)))parts.unshift(money(item.amount));
    return parts.filter(Boolean);
  }
  function reveal(attribute,id){
    requestAnimationFrame(()=>{
      const target=[...document.querySelectorAll(`[${attribute}]`)].find(el=>el.getAttribute(attribute)===String(id));
      if(!target)return;
      target.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'});
      target.classList.add('global-search-target');
      if(highlightTimer)clearTimeout(highlightTimer);
      highlightTimer=setTimeout(()=>target.classList.remove('global-search-target'),2600);
    });
  }
  function navigateSiteItem(item){
    if(!item)return false;
    if(item.group==='checks'){const check=model.state.checks?.find(row=>String(row.id)===String(item.id));ui.checkTab=checkIsClosedStatus(check?.status)?'closed':'open';ui.checkAccount=item.account==='ביתי'?'ביתי':'עסקי';ui.checkYear='all';ui.checkFocus='all';ui.checkSearchValue='';setPage('checks');reveal('data-bulk-id',item.id);return true}
    if(item.group==='credit'){ui.creditResultTarget=item.id;ui.expensesTab='credit';ui.creditAccountFilter='all';ui.creditProviderFilter='all';ui.creditCardFilter='all';ui.creditSearchValue='';ui.creditDetailMode='month';ui.creditDetailChargeDay='all';ui.creditDetailFocus={monthKey:item.monthKey||'',cardKey:item.cardKey||''};setPage('credit');reveal('data-credit-search-id',item.id);return true}
    if(item.group==='expenses'){ui.expensesTab='expenses';ui.expenseSearchValue='';setPage('credit');reveal('data-expense-id',item.id);return true}
    if(item.group==='cash'){ui.cashSearchValue='';setPage('cash');reveal('data-bulk-id',item.id);return true}
    if(item.group==='bank'){ui.bankAccountView=item.role==='home'?'home':'business';ui.bankDateMode='all';ui.bankDateFrom='';ui.bankDateTo='';ui.bankSearchValue='';setPage('bank');reveal('data-bank-search-id',item.id);return true}
    if(item.group==='notes'){ui.notesTab=item.kind==='sheet-row'?'sheet':'notes';if(item.kind==='sheet-row'){ui.notesSheetSearchValue='';ui.notesSheetId=item.sheetId||ui.notesSheetId}else ui.notesSearchValue='';setPage('notes');reveal(item.kind==='sheet-row'?'data-sheet-row-id':'data-note-id',item.id);return true}
    return false;
  }

  return createGlobalDocumentSearch({
    documentBridge,
    siteSearch:(raw,options)=>searchKupaGlobalEntries(indexedEntries(),raw,options),
    siteResultMeta,
    navigateSiteItem,
    confirmDialog,
    previewWidthKey:'netunim_kupa_document_preview_width_v1',
  });
}
