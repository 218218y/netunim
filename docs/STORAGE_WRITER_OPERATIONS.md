# Storage V2 — חוזה פעולות ה־Writer

מסמך זה הוא מפת הבעלות על כתיבות Storage V2 בצד השרת. מקור האמת האכיף נמצא במיגרציה `20260929093000_storage_writer_operation_contract.sql`; הטבלה כאן נועדה לביקורת ולתחזוקה ולא להחליף את החוזה שב־SQL.

העיקרון הוא ש־RPC ציבורי אינו בוחר בעצמו רשימת domains. הוא מצהיר על **operation**, וה־operation ממופה במקום מרכזי לכל ה־domains שהפעולה עשויה לשנות — גם כאשר הכתיבה נוצרת בעקיפין דרך trigger. מנגנון `storage_writer_invocations` הקיים נשאר גבול ההרשאה: `backend_pid + transaction_id + owner_id + domain`. אין שימוש ב־custom GUC כגבול הרשאה.

## מפת הפעולות

| Operation | Entry point | Lease | Writer domains | כתיבה/side effect מרכזי |
| --- | --- | --- | --- | --- |
| `orders-save` | `save_order_management_document_v6` | — | `orders` | שמירת מסמך Orders |
| `orders-bulk-delete` | `bulk_delete_save_order_management_document_v6` | — | `orders` | שמירה הרסנית + safety snapshot |
| `kupa-save` | `save_kupa_document_v6` | — | `kupa` | שמירת מסמך קופה |
| `kupa-bulk-delete` | `bulk_delete_save_kupa_document_v6` | — | `kupa` | שמירה הרסנית + safety snapshot |
| `shared-checks-save` | `save_shared_checks_document_v6` | — | `shared-checks` | שמירת מסמך הצ׳קים המשותפים |
| `shared-checks-bulk-delete` | `bulk_delete_save_shared_checks_document_v6` | — | `shared-checks` | שמירה הרסנית + safety snapshot |
| `restore-orders-stage` | `stage_restore_group_v6` | — | `orders` | staging metadata עבור שחזור Orders; אינו כותב Shared Checks |
| `restore-kupa-stage` | `stage_restore_group_v6` | — | `kupa` | staging metadata עבור שחזור קופה; אינו כותב Shared Checks |
| `restore-orders-apply` | `apply_restore_group_v6` | — | `orders`, `shared-checks` | החלת restore אטומית על Main ועל Shared Checks |
| `restore-kupa-apply` | `apply_restore_group_v6` | — | `kupa`, `shared-checks` | החלת restore אטומית על Main ועל Shared Checks |
| `bank-merge` | `merge_bank_transactions_v6` | `bank` | `kupa` | מיזוג תנועות בנק |
| `bank-archive-snapshot` | `sync_bank_transactions_snapshot_v6` | `bank` | `kupa`, `shared-checks` | snapshot מלא עשוי להפעיל reconciliation ולעדכן צ׳קים |
| `bank-balance-snapshot` | `save_bank_sync_snapshot_v6` | `bank` | `kupa` | שמירת snapshot/יתרה פיננסית |
| `finance-document-save` | `save_finance_sync_document_v6` | `bank` או `credit` | `kupa` | שמירת מסמך finance; אותו RPC משמש גם מסלול בנק וגם אשראי |

## למה `bank-archive-snapshot` הוא cross-domain

השרשרת הנוכחית היא:

```text
sync_bank_transactions_snapshot_v6
  -> fenced_impl_sync_bank_transactions_snapshot
  -> bank_transaction_snapshots
  -> trigger bank_snapshot_check_reconcile
  -> reconcile_check_bank_snapshot()
  -> netunim_internal.save_shared_checks_document(...)
  -> shared_checks_documents
  -> shared_checks_storage_protocol_guard
```

לכן `shared-checks` אינו הרשאה עודפת אלא side effect טרנזיטיבי של complete snapshot. ה־lease/fence של `bank` נבדק **לפני** פתיחת scope הכתיבה. snapshot לא מלא אינו יוצר את snapshot המלא שמפעיל reconciliation ולכן אינו אמור לשנות Shared Checks.

## כללי שינוי

1. RPC ציבורי חדש או קיים שמוגן ב־Storage V2 משתמש ב־`enter_storage_writer_operation_v2()`/`leave_storage_writer_operation_v2()` ולא ב־`enter_storage_writer_v2(domain)` ישירות.
2. שינוי trigger או פונקציה פנימית שמוסיף כתיבה ל־domain מוגן מחייב עדכון של חוזה ה־operation באותה מיגרציה או במיגרציה עוקבת לפני פריסה.
3. פעולה פיננסית חייבת להיות ממופה גם ל־lease המותר שלה. אימות lease/fence קודם לפתיחת writer scope.
4. `stage_restore_group_v6` ו־`apply_restore_group_v6` אינם אותה הרשאת כתיבה: stage נוגע רק ב־domain הראשי; apply הוא השלב הרב־תחומי.
5. אין להעביר reconciliation לקריאת לקוח נפרדת. ה־bank snapshot וה־Shared Checks reconciliation נשארים אטומיים באותה transaction.
6. `storage_writer_invocations` נשאר גבול האבטחה. טבלאות החוזה וה־helpers הפנימיים אינם נגישים ל־`anon`, `authenticated` או `service_role` ישירות.

## בדיקות חובה

`tests/storage_writer_protocol_server.py` הוא המבחן ההתנהגותי הראשי. הוא צריך לכסות לכל הפחות: lease שגוי, fence epoch ישן, owner isolation, complete לעומת incomplete snapshot, rollback אטומי בכשל reconciliation, אי־דליפת invocation לאחר כשל, והצלחת reconciliation אמיתי.

`tests/supabase_contracts.py` מוסיף התרעה סטטית מוקדמת: הוא בודק שה־RPCs במיגרציה החדשה אינם חוזרים לרשימות domain ידניות, שה־finance lease map נשמר, וששרשרת bank snapshot → Shared Checks מיוצגת בחוזה הרב־תחומי.
