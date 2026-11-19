# Netunim

Netunim contains two independently deployable Hebrew web apps. Orders manages customers, suppliers, documents and Morning workflows. Kupa manages cash, expenses and cash flow. Both use shared checks and finance data, with separate local storage and application shells.

## Start the apps

From a Windows checkout, run [.01run orders.bat](.01run%20orders.bat) or [.02‏‏run kupa.bat](.02%E2%80%8F%E2%80%8Frun%20kupa.bat) to open the corresponding app on localhost. The Windows document and bank connectors are separate installations.

## Developer documentation

| Task | Guide |
| --- | --- |
| Set up tools, edit shared assets and run focused tests | [Development and verification](docs/development/workflow.md) |
| Find the owner of a feature or data flow | [Architecture](docs/development/architecture.md) |
| Change persistence, sync or restore | [Storage and sync](docs/development/storage.md) · [Compatibility inventory](docs/development/compatibility.md) |
| Change bank, checks or credit behavior | [Finance contracts](docs/development/finance.md) |
| Check what still needs operational acceptance | [Open work](docs/development/open-work.md) · [Synthetic test lab](docs/development/test-lab.md) |
| Build, deploy, validate or roll back a site | [Site deployment](docs/operations/deployment.md) · [Staging](docs/operations/staging.md) |
| Release a database or Edge change | [Supabase operations](docs/operations/supabase.md) |
| Install a connector or recover data | [Windows connectors](docs/operations/connectors.md) · [Recovery](docs/operations/recovery.md) |
| Use the apps | [Orders](docs/operations/orders.md) · [Kupa](docs/operations/kupa.md) |
| Work on an integration | [Google](docs/integrations/google.md) · [Morning income](docs/integrations/morning-income.md) · [Morning expenses](docs/integrations/morning-expenses.md) · [Document search](docs/integrations/document-search.md) · [Tax calculator](docs/integrations/tax-calculator.md) |

Keep durable behavior and operating instructions in the guide closest to the owning code. Use the PR for one-time investigative findings, release notes and test results. Preserve compatibility evidence alongside the test or release gate that consumes it.
