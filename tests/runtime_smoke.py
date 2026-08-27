from pathlib import Path
import json
import sys

from browser_harness import BrowserSession, ROOT

apps = [
    ("kupa", ROOT / "netunim-kupa/site"),
    ("orders", ROOT / "netunim-orders/site"),
]
all_ok = True
for label, site in apps:
    try:
        with BrowserSession(site, label) as browser:
            state = browser.evaluate(
                "({ready:document.readyState,title:document.title,body:!!document.body,"
                "shared:typeof saveSharedChecksToCloud==='function',"
                "normalize:typeof normalizeSharedChecks==='function'})"
            )
            layout = None
            if label == "orders":
                layout = browser.evaluate(
                    r"""(async()=>{
                      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                      const near=(a,b,tolerance=2)=>Math.abs(a-b)<=tolerance;

                      state.suppliers=[{id:'SMOKE-SUP',name:'ספק בדיקה',active:true,sortOrder:0}];
                      state.transactions=Array.from({length:90},(_,i)=>({
                        id:'SMOKE-TR-'+i,supplierId:'SMOKE-SUP',sequence:i+1,kind:'הערה',
                        action:'פעולה '+i,debit:0,credit:0,invoiceReceived:null,signed:null,supplied:null,
                        supplyInfo:'',hmIssued:false,note:'',updatedAt:''
                      }));
                      state.customerDebts=Array.from({length:70},(_,i)=>({
                        id:'SMOKE-DEBT-'+i,customerName:'לקוח '+i,amount:1000+i,orderNumber:String(1000+i),
                        phone:'0500000000',paid:false,invoiceIssued:false,note:''
                      }));
                      state.serviceCalls=Array.from({length:48},(_,i)=>({
                        id:'SMOKE-SVC-'+i,customerName:'לקוח שירות '+i,orderNumber:String(i),phone:'',
                        address:'',description:'פירוט '+i,openedAt:`2026-08-${String((i%27)+1).padStart(2,'0')}`,
                        followUp:false,sent:false,escalated:false,closed:false,note:'',updatedAt:''
                      }));
                      state.warehouseOrders=Array.from({length:45},(_,i)=>({
                        id:'SMOKE-WH-'+i,customerName:'לקוח מחסן '+i,phone:'',status:'to_order',
                        details:'פרטי הזמנה '+i,location:'',note:'',updatedAt:''
                      }));
                      supplierViewportMemory.clear();scrollViewportMemory.clear();

                      currentSupplierId='SMOKE-SUP';currentView='supplier';supplierYearView='current';
                      filterMode='all';searchText='';renderSupplier({scrollMode:'auto'});await frame();
                      let supplierWrap=document.querySelector('.supplier-table-panel .table-wrap');
                      if(!supplierWrap)return {ok:false,reason:'missing supplier scroll container'};
                      const supplierInitial={top:supplierWrap.scrollTop,max:supplierWrap.scrollHeight-supplierWrap.clientHeight};

                      filterSupplierSearch('פעולה 1');await frame();
                      filterSupplierSearch('');await frame();
                      const supplierCleared={top:supplierWrap.scrollTop,max:supplierWrap.scrollHeight-supplierWrap.clientHeight};

                      supplierWrap.scrollTop=Math.round((supplierWrap.scrollHeight-supplierWrap.clientHeight)*0.42);await frame();
                      const supplierManual=supplierWrap.scrollTop;
                      switchView('customers');await frame();
                      switchView('supplier');await frame();
                      supplierWrap=document.querySelector('.supplier-table-panel .table-wrap');
                      const supplierReturned=supplierWrap?.scrollTop??-1;

                      currentView='customers';customerTab='debts';customerFilter='all';customerSearch='';renderCustomers();await frame();
                      const outer=document.querySelector('.customers-view .view-scroll');
                      let customerWrap=document.querySelector('.customer-work-table');
                      const summary=document.querySelector('.customer-bottom-summary');
                      if(!outer||!customerWrap||!summary)return {ok:false,reason:'missing customer layout nodes'};
                      customerWrap.scrollTop=customerWrap.scrollHeight;await frame();
                      const bottomTop=summary.getBoundingClientRect().top,bottomScroll=customerWrap.scrollTop;
                      customerWrap.scrollTop=Math.max(0,bottomScroll-120);await frame();
                      const raisedTop=summary.getBoundingClientRect().top;
                      customerWrap.scrollTop=Math.round((customerWrap.scrollHeight-customerWrap.clientHeight)*0.38);await frame();
                      const customerBefore=customerWrap.scrollTop;
                      setCustomerFlag('SMOKE-DEBT-20','paid',true);await frame();
                      customerWrap=document.querySelector('.customer-work-table');
                      const customerAfter=customerWrap?.scrollTop??-1;
                      const customerCell=document.querySelector('.customer-table tbody td');
                      const customerPadding=customerCell?getComputedStyle(customerCell).paddingTop:'';
                      const customerLayout={
                        outerClient:outer.clientHeight,outerScroll:outer.scrollHeight,outerTop:outer.scrollTop,
                        innerClient:customerWrap.clientHeight,innerScroll:customerWrap.scrollHeight,
                        summaryInScroller:summary.parentElement?.classList.contains('customer-work-table')===true
                      };

                      currentView='service';serviceFilter='all';serviceSearch='';renderService();await frame();
                      let serviceWrap=document.querySelector('.service-view-shell .view-scroll');
                      if(!serviceWrap)return {ok:false,reason:'missing service scroll container'};
                      serviceWrap.scrollTop=Math.round((serviceWrap.scrollHeight-serviceWrap.clientHeight)*0.55);await frame();
                      const serviceBefore=serviceWrap.scrollTop;
                      toggleServiceFlag('SMOKE-SVC-12','followUp');await frame();
                      serviceWrap=document.querySelector('.service-view-shell .view-scroll');
                      const serviceAfter=serviceWrap?.scrollTop??-1;

                      currentView='warehouse';warehouseTab='orders';warehouseSearch='';renderWarehouse();await frame();
                      let warehouseWrap=document.querySelector('.warehouse-view-shell .view-scroll');
                      if(!warehouseWrap)return {ok:false,reason:'missing warehouse scroll container'};
                      warehouseWrap.scrollTop=Math.round((warehouseWrap.scrollHeight-warehouseWrap.clientHeight)*0.5);await frame();
                      const warehouseBefore=warehouseWrap.scrollTop;
                      setWarehouseOrderStatus('SMOKE-WH-20','ordered');await frame();
                      warehouseWrap=document.querySelector('.warehouse-view-shell .view-scroll');
                      const warehouseAfter=warehouseWrap?.scrollTop??-1;

                      return {
                        ok:near(supplierInitial.top,supplierInitial.max)&&supplierInitial.max>0&&
                           near(supplierCleared.top,supplierCleared.max)&&
                           near(supplierReturned,supplierManual)&&
                           customerLayout.outerScroll<=customerLayout.outerClient+1&&customerLayout.outerTop===0&&
                           customerLayout.innerScroll>customerLayout.innerClient&&customerLayout.summaryInScroller&&
                           bottomScroll>0&&raisedTop>bottomTop+80&&near(customerAfter,customerBefore)&&
                           customerPadding==='2px'&&
                           serviceBefore>0&&near(serviceAfter,serviceBefore)&&
                           warehouseBefore>0&&near(warehouseAfter,warehouseBefore),
                        supplierInitial,supplierCleared,supplierManual,supplierReturned,customerLayout,
                        bottomScroll,summaryShift:raisedTop-bottomTop,customerBefore,customerAfter,customerPadding,
                        serviceBefore,serviceAfter,warehouseBefore,warehouseAfter
                      };
                    })()"""
                )
            errors = browser.drain_serious_errors()
            print(label, json.dumps({"state": state, "layout": layout, "exceptions": errors}, ensure_ascii=False))
            good = bool(
                state and state.get("ready") == "complete" and state.get("body") and
                state.get("shared") and state.get("normalize") and not errors and
                (label != "orders" or (layout and layout.get("ok")))
            )
            if not good:
                all_ok = False
    except Exception as exc:
        print(label, "FAIL", exc)
        all_ok = False

raise SystemExit(0 if all_ok else 1)
