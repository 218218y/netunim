from __future__ import annotations

from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def check(condition: bool, message: str) -> None:
    print(("PASS" if condition else "FAIL") + ": " + message)
    if not condition:
        errors.append(message)


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


shared = ROOT / "shared/cloud-backups.js"
check(shared.is_file(), "shared cloud-backup catalog/diff module exists")

node_test = f"""
import {{buildBackupCatalog,diffEntityCollection,summarizeBackupDiff,backupPointKey}} from {shared.as_uri()!r};
const rolling=[
  {{id:11,revision:7,saved_at:'2026-09-06T07:00:00Z'}},
  {{id:10,revision:6,saved_at:'2026-09-06T06:00:00Z'}},
];
const periodic=[
  {{id:21,revision:7,saved_at:'2026-09-06T07:05:00Z'}},
  {{id:20,revision:5,saved_at:'2026-09-05T18:00:00Z'}},
];
const catalog=buildBackupCatalog(rolling,periodic,{{rollingLimit:4,periodicLimit:4,totalLimit:8}});
if(catalog.length!==3) throw new Error('catalog did not dedupe same revision');
if(catalog[0].source!=='periodic'||catalog[0].revision!==7) throw new Error('catalog ordering is not newest-first');
const diff=diffEntityCollection([{{id:'a',v:2}},{{id:'b',v:1}}],[{{id:'a',v:1}},{{id:'c',v:1}}]);
if(diff.changed!==1||diff.removed!==1||diff.restored!==1||diff.totalChanges!==3) throw new Error('entity diff semantics are wrong');
const summary=summarizeBackupDiff({{rows:[{{id:'a',v:2}}],mode:'new'}},{{rows:[{{id:'a',v:1}}],mode:'old'}},{{collections:[{{path:'rows',label:'Rows'}}],config:[{{path:'mode',label:'Mode'}}]}});
if(summary.totalChanges!==2||summary.rows.length!==1||summary.settings.length!==1) throw new Error('summary diff semantics are wrong');
if(backupPointKey('rolling',12)!=='rolling:12') throw new Error('backup point key is wrong');
let rejected=false;try{{backupPointKey('rolling',0)}}catch{{rejected=true}}if(!rejected)throw new Error('invalid backup id was accepted');
"""
result = subprocess.run(["node", "--input-type=module", "-e", node_test], cwd=ROOT, capture_output=True, text=True)
if result.returncode:
    print(result.stdout)
    print(result.stderr)
check(result.returncode == 0, "backup catalog and diff helpers pass deterministic unit checks")

for app in ("netunim-kupa", "netunim-orders"):
    site = ROOT / app / "site"
    copied = site / "assets/js/shared/cloud-backups.js"
    check(copied.is_file() and copied.read_text(encoding="utf-8") == shared.read_text(encoding="utf-8"), f"{app}: shared backup helper is synchronized")
    css = (site / "assets/app.css").read_text(encoding="utf-8")
    check(".cloud-backup-center" in css and ".cloud-backup-diff-row" in css, f"{app}: backup center and preview are styled")

kupa_transport = read("netunim-kupa/site/assets/js/cloud/transport.js")
orders_transport = read("netunim-orders/site/assets/js/cloud/transport.js")
check("listKupaCloudBackups" in kupa_transport and "readKupaCloudBackupPoint" in kupa_transport, "kupa: backup list and point-in-time reader are exposed")
check("listOrdersCloudBackups" in orders_transport and "readOrdersCloudBackupPoint" in orders_transport, "orders: backup list and point-in-time reader are exposed")
check("saved_at=lte." in kupa_transport and "shared_checks_periodic_backups" in kupa_transport, "kupa: shared checks are paired at-or-before the primary backup time")
check("saved_at=lte." in orders_transport and "shared_checks_periodic_backups" in orders_transport, "orders: shared checks are paired at-or-before the primary backup time")

kupa_actions = read("netunim-kupa/site/assets/js/ui/actions.js")
orders_actions = read("netunim-orders/site/assets/js/ui/actions.js")
check("'restore-cloud-backup':(element,event)=>{previewCloudBackup" in kupa_actions, "kupa: list restore action is preview-first")
check("'restore-orders-cloud-backup':(element,event)=>{previewCloudBackup" in orders_actions, "orders: list restore action is preview-first")
check("apply-orders-cloud-backup-restore" in orders_actions and "all:['apply-json-restore','apply-orders-cloud-backup-restore'" in orders_actions, "orders: destructive cloud restore is protected by the startup mutation guard")

kupa_backup = read("netunim-kupa/site/assets/js/ui/backup.js")
orders_backup = read("netunim-orders/site/assets/js/ui/backup.js")
check("financeSyncIncluded:false" in kupa_backup and "target.creditSync=clone(live.creditSync)" in kupa_backup, "kupa: historical restore preserves live finance sync and downloaded backup marks finance as excluded")
check("bankEvents:normalizeSharedBankEvents(checksRow?.state?.bankEvents" in orders_backup, "orders: restore preserves the live shared-check bank event ledger")
check("!point?.checksState?.checks" in orders_backup and "!point?.checksState?.checks" in kupa_backup, "both apps reject an incomplete point-in-time restore without shared checks")

if errors:
    print("\nCloud backup contracts failed:")
    for error in errors:
        print("-", error)
    raise SystemExit(1)
print("\nALL CLOUD BACKUP CONTRACTS PASSED")
