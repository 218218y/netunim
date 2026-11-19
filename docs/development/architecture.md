# Architecture

Orders and Kupa are static, offline-capable web apps. Each development `site/index.html` starts `assets/app.js`, then `assets/js/main.js` composes state, capabilities and the lifecycle. The production build compiles each independent site and builds its own service-worker shell. The [deployment guide](../operations/deployment.md) describes the public payload and release boundaries.

| Area | Where to start |
| --- | --- |
| Orders | [Application modules](../../netunim-orders/site/assets/js) · [Edge functions](../../netunim-orders/supabase/functions) |
| Kupa | [Application modules](../../netunim-kupa/site/assets/js) |
| Shared business and browser contracts | [Canonical shared source](../../shared) · [Asset synchronization](../../tools/sync-assets.py) |
| Windows services | [Bank Bridge](../../netunim-kupa/bank-bridge) · [Document Bridge](../../netunim-orders/document-bridge) |
| Database | [Canonical migrations](../../supabase/migrations) · [Supabase operations](../operations/supabase.md) |
| Verification | [Suite plan](../../tests/verification_plan.py) · [Workflow](workflow.md) |

## Application boundaries

- `core/` holds pure primitives. `state/` defines, normalizes and serializes app state. `domains/` holds business calculations, commands, selectors and presentation.
- `storage/` and shared storage modules own the local durable data. `cloud/` owns transport and authentication. `sync/` owns coordination with the remote revision, pending work and acknowledgement. See [Storage and sync](storage.md).
- `ui/` and action packs bind UI events and invoke feature capabilities. `composition/` supplies the concrete dependencies, creates the runtime and owns its startup and disposal. Integrations use explicit ports for browser effects and Bridge calls. See the [shared menu behavior](../../shared/ui-menus.md).
- The bank companion owns provider sessions, credentials and local artifacts. The document companion owns authorized file access, Everything discovery, PDF indexing and preview lifetime. See [Windows connectors](../operations/connectors.md) and [Document search and preview](../integrations/document-search.md).
- Calendar and independent workbooks have distinct transaction owners. Google Calendar owns the calendar's remote state. Independent workbooks persist per-document revisions through their own RPCs and recovery records. See [Google integrations](../integrations/google.md) and [Storage and sync](storage.md).

## Add or change a feature

1. Identify the existing command and durable owner before adding a write. Extend its input decoder and operation schema where required. Scope read models and views to the existing query APIs.
2. Capture account, owner and leadership scope before asynchronous effects, including native pickers. Decode external values and recheck scope after awaits before publishing. Keep local commit, remote ACK, view publication and optional mirrors or cleanup distinct.
3. Register UI actions through the owning action pack and return the command completion. Inject I/O via the existing composition. Give timers, listeners and native resources a lifecycle, and drain accepted writes on shutdown. Kupa's [bank composition](../../netunim-kupa/site/assets/js/composition/bank.js) is one example.
4. Cover failure, cancellation and recovery at the affected owner. Check historical consumers before changing persisted fields, deployed APIs or generated copies. Use the [compatibility inventory](compatibility.md).
