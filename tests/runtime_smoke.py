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
                    r"""(()=>{
                      state.customerDebts=Array.from({length:60},(_,i)=>({
                        id:'SMOKE-'+i,customerName:'לקוח '+i,amount:1000+i,orderNumber:String(1000+i),
                        phone:'0500000000',paid:false,invoiceIssued:false,note:''
                      }));
                      customerTab='debts';customerFilter='all';customerSearch='';renderCustomers();
                      const outer=document.querySelector('.customers-view .view-scroll');
                      const inner=document.querySelector('.customer-work-table');
                      const summary=document.querySelector('.customer-bottom-summary');
                      if(!outer||!inner||!summary)return {ok:false,reason:'missing customer layout nodes'};
                      inner.scrollTop=inner.scrollHeight;
                      const bottomTop=summary.getBoundingClientRect().top,bottomScroll=inner.scrollTop;
                      inner.scrollTop=Math.max(0,bottomScroll-120);
                      const raisedTop=summary.getBoundingClientRect().top;
                      return {
                        ok:outer.scrollHeight<=outer.clientHeight+1&&outer.scrollTop===0&&
                           inner.scrollHeight>inner.clientHeight&&summary.parentElement===inner&&
                           bottomScroll>0&&raisedTop>bottomTop+80,
                        outerClient:outer.clientHeight,outerScroll:outer.scrollHeight,
                        innerClient:inner.clientHeight,innerScroll:inner.scrollHeight,
                        bottomScroll,summaryShift:raisedTop-bottomTop
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
