"""Focused real-browser acceptance for both dashboard positions and disclosures."""
from browser_harness import BrowserSession, ROOT


def run_dashboard_position(app):
    with BrowserSession(ROOT / f'netunim-{app}/site', f'{app}-dashboard-position') as browser:
        browser.evaluate(r"""(async()=>{
          const {kupaBusinessPositionData}=await import('./assets/js/shared/business-position.js');
          const {kupaAccountCashflowData}=await import('./assets/js/shared/kupa-cashflow.js');
          const {createDomainsDashboardView}=await import('./assets/js/domains/dashboard/view.js');
          const d=new Date(),today=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
          const fixture={bank:{currentBalance:1000.01,source:'manual',asOfDate:today},cash:[{id:'cash',amount:0.06}],
            checks:[{id:'far',name:'צ׳ק עתידי לבדיקה',status:'בקופה',account:'עסקי',amount:200.04,dueDate:'2099-01-10'}],
            credits:[{id:'card',card:'כרטיס לבדיקה',active:true,totalAmount:100.02,installments:1,firstChargeDate:today,account:'עסקי'}],
            expenses:[{id:'expense',description:'הוצאה לבדיקה',active:true,recurring:false,account:'עסקי',date:today,amount:10.03}]};
          const p=kupaBusinessPositionData(fixture,today);
          const role=value=>value==='home'?'ביתי':'עסקי';
          const bankQueries={balance:value=>kupaAccountCashflowData(fixture,role(value),today).balance,forecast:value=>kupaAccountCashflowData(fixture,role(value),today),projectedBalance:value=>kupaAccountCashflowData(fixture,role(value),today).projected,asOfDate:()=>today,longTermPosition:()=>p};
          window.__positionFixture=fixture;
          window.__positionRender={createDomainsDashboardView,p,bankQueries};
          return true;
        })()""")
        if app == 'kupa':
            browser.evaluate(r"""(()=>{
              state=normalizeState(window.__positionFixture);domainRevisions.touchAll();
              const {createDomainsDashboardView,bankQueries}=window.__positionRender;
              createDomainsDashboardView({model:{state},bankQueries,checks:{active:()=>state.checks,deposited:()=>[]},localBankSnapshot:()=>null,orders:{summary:()=>({customerOpen:0.11,supplierNet:-0.03}),refresh:()=>{}}}).renderDashboard();
              return true;
            })()""")
        else:
            browser.evaluate(r"""(()=>{
              const {createDomainsDashboardView,p}=window.__positionRender;
              createDomainsDashboardView({model:{state:{suppliers:[]}},ui:{summarySupplierYearView:'all'},checksSession:{kupaNetReadout:{...p,net:p.netWithoutCash}},totalStats:()=>({net:-0.03}),customerStats:()=>({openTotal:0.11,open:1}),supplierArchiveYears:()=>[],mountViewLayout:()=>{}}).renderSummary();
              return true;
            })()""")
        for width in (1280, 768, 390):
            browser.call('Emulation.setDeviceMetricsOverride', {'width': width, 'height': 900, 'deviceScaleFactor': 1, 'mobile': False})
            browser.evaluate("""(()=>{
              const root=document.querySelector('.business-position-details');
              if(!root)throw new Error('Missing balance details');
              root.open=true;
              for(const child of root.querySelectorAll('details'))child.open=true;
              if(!root.textContent.includes('200.04')||!root.textContent.includes('100.02')||!root.textContent.includes('10.03'))throw new Error('Missing all-future contributing rows');
              const total=document.querySelector('%s');
              if(!total.textContent.includes('%s'))throw new Error('Wrong cent-precise total: '+total.textContent);
              for(const node of [root,...root.querySelectorAll('table,li')])if(node.scrollWidth>node.clientWidth+2)throw new Error('Balance details overflow at %dpx: '+node.tagName+' '+node.scrollWidth+'/'+node.clientWidth+' '+node.textContent);
              return true;
            })()""" % ('.net-total>b' if app == 'kupa' else '.forecast-value', '1,090.14' if app == 'kupa' else '1,090.08', width))
            if app == 'kupa':
                browser.evaluate("""(()=>{
                  const panels=document.querySelectorAll('.bank-account-overview');
                  if(panels.length!==2)throw new Error('Missing account panels');
                  for(const panel of panels){
                    if(panel.querySelectorAll('.bank-readonly-value,.bank-value').length!==2)throw new Error('Each account must show two balances');
                    if(panel.scrollWidth>panel.clientWidth+2)throw new Error('Account panel overflows');
                    panel.querySelector('[data-action="cashflow-breakdown"]').click();
                    if(!document.querySelector('#modal [data-cashflow-explorer]'))throw new Error('Forecast details dialog does not open');
                    closeModal(true);
                  }
                  return true;
                })()""")
        assert not browser.drain_serious_errors()
        print(f'{app}: exact dashboard position, contributing rows, two bank balances and responsive details passed')


if __name__ == '__main__':
    for application in ('orders', 'kupa'):
        run_dashboard_position(application)
