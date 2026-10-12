import {createDomainsDashboardController} from '../domains/dashboard/controller.js';
import {createDomainsDashboardView} from '../domains/dashboard/view.js';
import {ordersFinanceSummaryData} from '../shared/orders-finance.js';

function requireMethods(name, port, methods) {
  for (const method of methods) {
    if (typeof port?.[method] !== 'function') throw new TypeError(`dashboard_${name}_${method}_required`);
  }
}

export function createKupaDashboardCapability({model, ui, access, remote, touchRevision, runFinance, platform={}}) {
  if (!model || !ui || typeof touchRevision !== 'function' || typeof runFinance !== 'function') {
    throw new TypeError('dashboard_context_required');
  }
  requireMethods('access', access, ['current', 'subscribe']);
  requireMethods('remote', remote, ['readMeta', 'readDocument']);
  const isOnline = platform.isOnline ?? (() => globalThis.navigator?.onLine !== false);
  const clock = platform.clock ?? (() => Date.now());
  if (typeof isOnline !== 'function' || typeof clock !== 'function') throw new TypeError('dashboard_platform_required');
  let view = null, disposed = false;
  const controller = createDomainsDashboardController({
    access:{current:() => ({...access.current(), online:isOnline()}), subscribe:access.subscribe},
    remote, project:ordersFinanceSummaryData, clock,
    onError:error => console.error('orders finance summary read', error),
    onChange:({renderIfChanged}) => {
      if (disposed) return;
      touchRevision();
      if (renderIfChanged && ui.currentPage === 'dashboard' && view) view.renderDashboard();
    },
  });
  function ready() {
    if (disposed) throw new Error('dashboard_disposed');
    if (!view) throw new Error('dashboard_view_not_bound');
    return view;
  }

  function bindView({bank, checks, localBankSnapshot}) {
    if (disposed) throw new Error('dashboard_disposed');
    if (view) throw new Error('dashboard_view_already_bound');
    requireMethods('bank_queries', bank, ['balance', 'asOfDate', 'forecast', 'projectedBalance', 'longTermPosition']);
    requireMethods('checks_queries', checks, ['active', 'deposited']);
    if (typeof localBankSnapshot !== 'function') throw new TypeError('dashboard_bank_snapshot_required');
    view = createDomainsDashboardView({
      model, runFinance, bankQueries:bank, checks, localBankSnapshot,
      orders:{summary:controller.summary, refresh:controller.refreshOrdersFinanceSummary},
    });
  }

  return {
    bindView, assertReady:() => { ready(); return true; },
    queries:{ordersSummary:controller.summary},
    commands:{refreshOrdersSummary:controller.refreshOrdersFinanceSummary},
    presentation:{
      renderDashboard:(...args) => disposed ? false : ready().renderDashboard(...args),
      kpi:(...args) => ready().kpi(...args),
    },
    runtime:{
      start() { ready(); return controller.runtime.start(); },
      stop:controller.runtime.stop, drain:controller.runtime.drain, isPending:controller.runtime.isPending,
      dispose() { if (disposed) return false; disposed = true; controller.runtime.dispose(); return true; },
    },
  };
}
