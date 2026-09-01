from __future__ import annotations

import json

from browser_harness import BrowserSession, ROOT


VIEWPORTS = [
    (320, 640),
    (360, 740),
    (393, 852),
    (412, 915),
    (480, 800),
    (600, 900),
    (768, 1024),
    (820, 1180),
    (1024, 768),
    (1366, 768),
    (1920, 1080),
    (568, 320),
    (800, 480),
    (1024, 600),
]


def set_viewport(browser: BrowserSession, width: int, height: int) -> None:
    response = browser.call(
        "Emulation.setDeviceMetricsOverride",
        {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": False,
        },
    )
    assert not response.get("error"), response
    response = browser.call(
        "Emulation.setTouchEmulationEnabled",
        {"enabled": width <= 820, "maxTouchPoints": 5},
    )
    assert not response.get("error"), response


COMMON_LAYOUT_CHECK = r"""
const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
const withinViewport=element=>{
  if(!element)return false;
  const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
  return style.display!=='none'&&style.visibility!=='hidden'&&rect.left>=-1&&rect.right<=innerWidth+1&&rect.top>=-1&&rect.bottom<=innerHeight+1;
};
const horizontalScrollOwner=element=>{
  for(let node=element.parentElement;node&&node!==document.body;node=node.parentElement){
    const style=getComputedStyle(node);
    if((style.overflowX==='auto'||style.overflowX==='scroll')&&node.scrollWidth>node.clientWidth+1)return node;
  }
  return null;
};
const layoutSnapshot=()=>{
  const rootWidth=document.documentElement.clientWidth;
  const globalWidth=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);
  const unownedWideTables=[...document.querySelectorAll('table')].filter(table=>{
    const rect=table.getBoundingClientRect();
    return rect.width>rootWidth+1&&!horizontalScrollOwner(table);
  }).map(table=>table.className||'table');
  const outsideElements=[...document.querySelectorAll('body *')].filter(element=>{
    const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
    if(style.display==='none'||style.visibility==='hidden'||style.position==='fixed'||rect.width===0||element.closest('.sidebar'))return false;
    return (rect.left<-1||rect.right>rootWidth+1)&&!horizontalScrollOwner(element);
  }).slice(0,8).map(element=>{
    const rect=element.getBoundingClientRect();
    return {node:element.tagName.toLowerCase()+'.'+element.className,left:Math.round(rect.left),right:Math.round(rect.right),width:Math.round(rect.width)};
  });
  return {
    rootWidth,globalWidth,
    globalOverflow:globalWidth-rootWidth,
    unownedWideTables,outsideElements,
    mainWidth:document.querySelector('.main')?.getBoundingClientRect().width||0,
  };
};
"""


def check_orders(browser: BrowserSession) -> list[dict]:
    browser.evaluate(
        r"""(()=>{
          state.customerDebts=[{id:'RESP-DEBT',customerName:'לקוח בדיקה',amount:1250,orderNumber:'42',phone:'0500000000',paid:false,supplied:false,invoiceIssued:false,note:'הערה'}];
          state.customerOrders=[{id:'RESP-ORDER',orderNumber:'42',customerName:'לקוח בדיקה',mark1:'א',mark2:'ב',mark3:'ג',mattresses:'מזרן',note:'הערה'}];
          state.checks=[{id:'RESP-CHECK',name:'לקוח בדיקה',amount:900,dueDate:'2026-09-15',status:'בקופה',checkNumber:'123',note:'הערה'}];
          return true;
        })()"""
    )
    results = []
    for width, height in VIEWPORTS:
        set_viewport(browser, width, height)
        result = browser.evaluate(
            "(async()=>{" + COMMON_LAYOUT_CHECK + r"""
              const routes=['customers','customer-orders','warehouse','service','kupa','notes','calendar','settings','supplier'];
              const routeResults=[];
              for(const route of routes){
                document.querySelector(`[data-view="${route}"]`)?.click();await frame();
                routeResults.push({route,...layoutSnapshot()});
              }
              const folder=document.getElementById('folderAccessButton');
              folder.hidden=false;folder.textContent='אשר תיקייה';await frame();
              const settings=document.getElementById('settingsTopButton');
              const header={
                settingsVisible:withinViewport(settings),
                settingsLabel:settings?.getAttribute('aria-label'),
                settingsText:settings?.textContent?.trim()||'',
                folderVisible:withinViewport(folder),
                topbarWidth:document.querySelector('.topbar')?.getBoundingClientRect().width||0,
              };
              document.querySelector('[data-view="customers"]')?.click();await frame();
              document.querySelector('[data-action="open-debt-modal"]')?.click();await frame();
              const modal=document.querySelector('.modal-backdrop.open .modal');
              const modalVisible=withinViewport(modal);
              document.getElementById('modalBackdrop')?.classList.remove('open');
              const mobileCards=innerWidth<=600?{
                debtRow:getComputedStyle(document.querySelector('.customer-table tbody tr')).display,
                debtTableMin:getComputedStyle(document.querySelector('.customer-table')).minWidth,
              }:null;
              const customerToolbar=innerWidth<=700?{
                tabs:document.querySelector('.customer-command > .module-tabs')?.getBoundingClientRect().top,
                search:document.querySelector('.customer-command > .customer-search')?.getBoundingClientRect().top,
                filters:document.querySelector('.customer-command > .filters')?.getBoundingClientRect().top,
                actions:document.querySelector('.customer-command > .customer-add-btn')?.getBoundingClientRect().top,
              }:null;
              return {width:innerWidth,height:innerHeight,routeResults,header,modalVisible,mobileCards,customerToolbar};
            })()"""
        )
        assert result["width"] == width and result["height"] == height, result
        assert result["header"]["settingsVisible"], result
        assert result["header"]["folderVisible"], result
        assert result["header"]["settingsLabel"] == "הגדרות", result
        assert not result["header"]["settingsText"], result
        assert result["modalVisible"], result
        if width <= 600:
            assert result["mobileCards"] == {"debtRow": "grid", "debtTableMin": "0px"}, result
        if width <= 700:
            toolbar = result["customerToolbar"]
            assert toolbar["tabs"] < toolbar["search"] < toolbar["filters"] < toolbar["actions"], result
        for route in result["routeResults"]:
            assert route["globalOverflow"] <= 1, result
            assert not route["unownedWideTables"], result
            assert route["mainWidth"] <= width + 1, result
        results.append(result)
    return results


def check_kupa(browser: BrowserSession) -> list[dict]:
    browser.evaluate(
        r"""(()=>{
          document.getElementById('connectScreen').style.display='none';
          model.state.checks=[{id:'RESP-CHECK',name:'לקוח בדיקה',amount:900,dueDate:'2026-09-15',status:'בקופה',checkNumber:'123',note:'הערה'}];
          model.state.cash=[{id:'RESP-CASH',date:'2026-09-01',type:'הכנסה',description:'בדיקה',amount:500,note:'הערה'}];
          model.state.cards=[{name:'כרטיס בדיקה',account:'עסקי',chargeDay:10,active:true}];
          return true;
        })()"""
    )
    results = []
    for width, height in VIEWPORTS:
        set_viewport(browser, width, height)
        result = browser.evaluate(
            "(async()=>{" + COMMON_LAYOUT_CHECK + r"""
              const routes=['dashboard','checks','credit','cash','bank','settings'];
              const routeResults=[];
              for(const route of routes){
                document.querySelector(`[data-page="${route}"]`)?.click();await frame();
                routeResults.push({route,...layoutSnapshot()});
              }
              const menu=document.getElementById('mobileMenu'),sidebar=document.getElementById('sidebar'),backdrop=document.getElementById('sidebarBackdrop');
              let drawer=null;
              if(innerWidth<=820){
                menu.click();await new Promise(resolve=>setTimeout(resolve,240));await frame();
                const sidebarRect=sidebar.getBoundingClientRect();
                drawer={open:sidebar.classList.contains('open'),visible:withinViewport(sidebar),expanded:menu.getAttribute('aria-expanded'),backdrop:backdrop.classList.contains('open'),rect:{left:sidebarRect.left,right:sidebarRect.right,top:sidebarRect.top,bottom:sidebarRect.bottom}};
                backdrop.click();await frame();
                drawer.closed=!sidebar.classList.contains('open')&&menu.getAttribute('aria-expanded')==='false';
              }else drawer={desktopVisible:withinViewport(sidebar),expanded:menu.getAttribute('aria-expanded')};
              document.querySelector('[data-page="checks"]')?.click();await frame();
              document.getElementById('quickAddCheck')?.click();await frame();
              const modal=document.querySelector('.modal-backdrop.open .modal');
              const modalVisible=withinViewport(modal);
              document.getElementById('modalBackdrop')?.classList.remove('open');
              document.querySelector('[data-page="cash"]')?.click();await frame();
              const cashColumns=getComputedStyle(document.querySelector('.cash-kpis')).gridTemplateColumns.split(' ').length;
              const mobileCashRow=innerWidth<=600?getComputedStyle(document.querySelector('.cash-table tbody tr')).display:null;
              document.querySelector('[data-page="settings"]')?.click();await frame();
              const settingsRow=innerWidth<=600?getComputedStyle(document.querySelector('.settings-table tbody tr')).display:null;
              return {width:innerWidth,height:innerHeight,routeResults,drawer,modalVisible,cashColumns,mobileCashRow,settingsRow};
            })()"""
        )
        assert result["width"] == width and result["height"] == height, result
        assert result["modalVisible"], result
        if width <= 820:
            drawer = result["drawer"]
            assert drawer["open"] and drawer["visible"] and drawer["expanded"] == "true" and drawer["backdrop"] and drawer["closed"], result
        else:
            assert result["drawer"]["desktopVisible"] and result["drawer"]["expanded"] == "false", result
        expected_columns = 1 if width <= 600 else 2 if width <= 820 else 3
        assert result["cashColumns"] == expected_columns, result
        if width <= 600:
            assert result["mobileCashRow"] == "grid" and result["settingsRow"] == "grid", result
        for route in result["routeResults"]:
            assert route["globalOverflow"] <= 1, result
            assert not route["unownedWideTables"], result
            assert route["mainWidth"] <= width + 1, result
        results.append(result)
    return results


all_results = {}
for label, check in (("orders", check_orders), ("kupa", check_kupa)):
    with BrowserSession(ROOT / f"netunim-{label}/site", f"{label}-responsive") as session:
        all_results[label] = check(session)
        errors = session.drain_serious_errors()
        assert not errors, errors
        print(
            "PASS",
            label,
            "responsive shell, local overflow, drawer/modal and compact data renderers across",
            len(VIEWPORTS),
            "viewports",
        )

print(json.dumps({key: len(value) for key, value in all_results.items()}, ensure_ascii=False))
