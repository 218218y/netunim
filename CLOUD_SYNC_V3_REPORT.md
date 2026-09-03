# דוח שדרוג מנגנון השמירה והסנכרון לענן — Lossless Sync v3

תאריך אימות מקומי אחרון: 2026-09-03
פרויקט: `netunim` (`netunim-orders`, `netunim-kupa`)  
סטטוס קוד: היישום ובדיקות ה־client הושלמו. ה־migration לא הוחל על production ולא בוצע stress על נתוני production. מדידות SQL וקבלת עומס שרת מסומנות במפורש כ־**ממתין ל־staging ייעודי**.

## 1. תקציר מנהלים

השדרוג משמר את מנגנוני ההגנה הקיימים ומוסיף מעליהם שכבת lossless אחידה:

- Durable Outbox v3 עבור Orders, Kupa ו־Shared Checks, כאשר IndexedDB הוא המקור העמיד ו־localStorage הוא cache/fallback.
- ACK תלוי generation: ACK ישן לעולם אינו מוחק דור חדש יותר.
- rebase של שינוי שנוצר בזמן RPC על בסיס התשובה שאושרה מהשרת.
- חוזה שגיאות מרכזי ומכני: `PT429`, `PT409`, outage, auth, timeout, network ו־fatal.
- retry ל־`save_busy` בלבד, מוגבל לשלושה ניסיונות לאותו snapshot בדיוק.
- conflict מוביל לקריאה אחת ול־3-way merge; אין blind overwrite.
- retry אחרי timeout/אובדן ACK מופעל רק ל־RPCs שהוכחו כ־idempotent.
- scheduler יחיד לכל app instance, עם HIGH לכתיבות ו־LOW ל־polling, coalescing לקריאות רקע ו־circuit breaker.
- refresh token single-flight, ובדיקה חוזרת של ה־session תחת `navigator.locks` כאשר הוא זמין.
- Calendar background work מתחיל רק אחרי הכרעת primary tab; secondary tab לא יוצר תעבורת Calendar אוטומטית.
- fallback של primary-tab election באמצעות BroadcastChannel ו־localStorage heartbeat כאשר Web Locks אינו זמין.
- idempotency אמיתית ל־Finance ול־Bank snapshot, כולל דחייה קשיחה של שימוש חוזר באותו token עם payload שונה.

לא בוצע rewrite רחב. נשמרו:

- `pg_try_advisory_xact_lock`;
- `save_busy` / `PT429`;
- `lock_timeout = 100ms`;
- המימושים הפרטיים תחת `netunim_internal` וה־public SECURITY INVOKER wrappers;
- optimistic revisions;
- Data API circuit breaker ו־concurrency 1;
- IndexedDB/browser fallback וה־recovery הקיים;
- primary-tab architecture;
- Service Worker deterministic assets;
- ה־financial advisory gate המשותף.

## 2. חולשות ושורשי הבעיה שנמצאו

1. Orders שמר marker עיקרי, אך provenance מלא של `baseRevision`, `baseState` ו־snapshot לא היה אטומי ברשומת pending אחת.
2. Shared Checks הסתמך יותר מדי על localStorage ועל base מפוצל בין כמה מפתחות.
3. ניקוי pending לא היה אחיד ומוגן בכל המסלולים מפני ACK של דור ישן.
4. זיהוי שגיאות נשען בחלק מהקוד על טקסט הודעה, ולכן `40001`, `save_busy` ו־outage עלולים היו לקבל semantics שגויים.
5. FIFO יחיד של Data API נתן ל־GET רקע אפשרות לעכב write שכבר נשמר מקומית.
6. קריאות GET רקע ירשו retry רשת ארוך, וכמה subsystems יכלו להאריך outage lane.
7. `save_finance_sync_document` בדק conflict לפני equality ולכן replay לאחר lost ACK היה עלול להפוך לקונפליקט מדומה.
8. `save_bank_sync_snapshot` נשא token אך לא השתמש בו כלדג'ר idempotency שמאמת payload.
9. refresh token לא היה single-flight בתוך אותו app.
10. Calendar restore/sync היה יכול להתחיל לפני הכרעת primary tab.
11. בהיעדר Web Locks לא הייתה election מצמצמת writers.
12. מסלול bootstrap יחיד של Shared Checks ב־Kupa עקף את מדיניות `save_busy` המשותפת; הוא אותר ב־audit האחרון ותוקן.
13. ב־Supabase נצפו ארבע קריאות meta נפרדות במחזור polling, וגילינו היסטוריית bursts של revision conflicts. איחוד version probes נשאר P2 ואינו תנאי correctness.

## 3. ארכיטקטורה — לפני ואחרי

### לפני

```text
UI mutation
  -> local state/localStorage
  -> pending marker או pending חלקי
  -> FIFO Data API
  -> RPC
  -> clear pending
```

Orders, Kupa ו־Checks ניהלו pending, retry ו־error interpretation בצורה שונה. ACK, base provenance ו־recovery לא היו primitive משותף.

### אחרי

```text
UI mutation
  -> canonical state + generation
  -> Outbox v3 (IndexedDB source of truth + localStorage cache)
  -> durable commit barrier
  -> HIGH priority scheduler / breaker gate
  -> idempotent RPC
      PT429 -> same snapshot, jittered bounded retry
      PT409 -> one remote read -> 3-way merge -> bounded retry
      outage -> retain outbox, open breaker, recover later
  -> ACK for generation N
      current == N -> exact clear
      current > N  -> rebase current on ACKed server state and continue
```

כל request של Data API נשאר serialized (`maxConcurrency=1`). HIGH מקבל קדימות על poll חדש; LOW זהה עובר coalescing; אחרי ארבע כתיבות ממתינות ניתנת הזדמנות לקריאה כדי למנוע starvation.

## 4. מיפוי writers וחוזי lost ACK

| Writer | Optimistic / key | Idempotency | backup / side effects | advisory lock | Clients | lost ACK |
|---|---|---|---|---|---|---|
| `save_order_management_document_v3` | `p_expected_revision` + `operationId` | private operation ledger + payload SHA-256; legacy writer נשאר לתאימות | previous-state/periodic backup, state+revision | Orders lock עצמאי per owner/document | Orders | replay מזוהה גם אם writer אחר כבר קידם את המסמך; מוחזר current state + original operation revision |
| `save_kupa_document_v3` | `p_expected_revision` + `operationId` | private operation ledger + payload SHA-256; legacy writer נשאר לתאימות | previous-state/periodic backup, Kupa-only state+revision | financial gate per owner | Kupa וגם Kupa המוטמע ב־Orders | replay אינו מבצע side effect ומחזיר את state העדכני גם אחרי intervening write |
| `save_shared_checks_document_v3` | `p_expected_revision` + `operationId` | private operation ledger + payload SHA-256; legacy writer נשאר לתאימות | backup; הקצאת financial sequence ו־bank-event deltas רק לשינוי אמיתי | financial gate | שני האתרים | replay לא מקצה event/sequence נוסף ומזוהה גם אחרי שינוי מרוחק נוסף |
| `save_finance_sync_document_v3` | `p_expected_revision` + `operationId` | private operation ledger + payload SHA-256; internal legacy path שומר equality-before-conflict | Finance state+revision | financial gate | Orders/Kupa finance | replay אינו מעלה revision ומחזיר current state + original operation revision |
| `save_bank_sync_snapshot` | `snapshotToken` + seq + SHA-256 payload | ledger חדש owner/document/token | Finance+Kupa atomic update; אין הפעלה חוזרת של checks | financial gate; row order Kupa ואז Finance | Orders/Kupa bank | token זהה+payload זהה מחזיר revisions; payload שונה -> `PT422` |
| `merge_bank_transactions` | owner/account/role/merge key | upsert + content verification | insert/update archive rows | financial gate | Orders/Kupa bank | אותו batch פעמיים: replay עם 0 insert/0 update |
| `claim_finance_sync_lease` | lease token | אותו token מחדש/מאריך את אותה lease | lease row בלבד | row/UPSERT contract | Orders/Kupa | replay בטוח |
| `release_finance_sync_lease` | lease token | אותו token יכול להשתחרר שוב | lease timestamp בלבד | row update | Orders/Kupa | replay בטוח |
| Calendar Edge Function writes | OAuth state/connection + Google event operation journal | חוזים קיימים של OAuth/journal | OAuth state/connection ו־Google events | לא data correctness lock | Orders primary/explicit | Data API outage מוחזר כ־503 סמנטי; journal נשאר |

REST writes נוספים שאינם Supabase document writers הם פעולות local Bank Bridge ו־Google Calendar API. הם לא קיבלו retry גלובלי חדש; מנגנוני journal/lease הקיימים נשמרו.

## 5. Durable Outbox v3

הרשומה הקנונית מכילה:

```json
{
  "schemaVersion": 3,
  "domain": "orders | kupa | shared-checks",
  "documentName": "...",
  "operationId": "...",
  "generation": 1,
  "baseRevision": 0,
  "baseState": {},
  "snapshot": {},
  "createdAt": "...",
  "updatedAt": "...",
  "conflict": null,
  "retry": {
    "attempts": 0,
    "lastErrorCode": null,
    "lastAttemptAt": null,
    "nextAttemptAt": null
  }
}
```

כללי היישום:

1. mutation מעדכן state וקובע generation חדש.
2. נבנה snapshot קנוני; אין תור של snapshot לכל הקלדה — הרשומה האחרונה מחליפה/coalesces את הקודמת.
3. הרשומה נכתבת ל־localStorage כ־fast cache ונשלחת ל־IndexedDB.
4. RPC אינו מתחיל לפני ש־`getPending()` המתין ל־commit barrier.
5. כשל IndexedDB עם localStorage תקין מסמן degraded durability; המידע נשמר ולא מוצג כ־fully synced.
6. כשל בשני אמצעי האחסון מעלה `*_outbox_persistence_failed` לפני RPC.
7. migration מזהה Orders marker ישן, Kupa v2 ו־Checks markers; המקור הישן אינו נמחק לפני כתיבת v3 מוצלחת.
8. clear דורש integer generation זהה. `undefined`, `Infinity` או ACK ישן נדחים.
9. אם מחיקת IndexedDB או localStorage נכשלת לאחר ACK, הרשומה נשארת/משוחזרת וה־UI מציג recovery במקום synced.

## 6. חוזה שגיאות ו־retry policy

`normalizeCloudError()` מחזיר `kind`, `code`, `status`, `retryAfterMs` ו־`original`.

- `PT429` / legacy `save_busy` -> `busy`.
- HTTP 429 כללי -> `rate_limited`; שכבת Data API מכבדת `Retry-After` ואינה מבלבלת אותו עם contention.
- `PT409` / legacy message `revision_conflict` -> `revision_conflict`.
- HTTP 409 כללי -> `conflict`; הוא אינו מומר אוטומטית לקונפליקט revision.
- SQLSTATE `40001` כללי **אינו** מסווג אוטומטית כ־revision conflict.
- 502/503/504 ו־PGRST002/PGRST003 -> `service_unavailable`.
- 401/403/42501 -> `auth`.
- Abort/timeout -> `timeout`.
- fetch/network -> `network`.

Policy:

- Busy: עד 3 ניסיונות מיידיים עם jittered exponential backoff, אותו closure ואותו snapshot. אין remote read ואין merge.
- Conflict: jitter קצר, remote read יחיד למחזור, 3-way merge מול base/local/remote. קונפליקט באותה entity נשמר ב־outbox ונעצר fail-closed.
- 502/503/504/network: breaker נפתח; pending נשאר; אין merge.
- retry אחרי ambiguity קיים רק ב־RPCs שבטבלה לעיל והוכחו idempotent.
- אין endless retry ואין retry גלובלי לכל POST.

## 7. Scheduler, polling ו־auth

- lane יחיד לכל app instance נשמר.
- writes/recovery הם HIGH; meta/full polling הוא LOW.
- poll זהה ממתין פעם אחת ומחזיר clone לכל caller.
- breaker פתוח דוחה queued/background calls מקומית.
- `PT429` אינו פותח service breaker; HTTP 429 כללי מפעיל rate-limit gate נפרד לפי `Retry-After` (או backoff שמרני אם הכותרת חסרה).
- background reads משתמשים בניסיון רשת יחיד וב־8 שניות לכל היותר; ה־20 שניות/3 ניסיונות נשמרו למסלולים מפורשים ובטוחים בלבד. יש לכייל את המספר מול מדידות staging לפני שינוי נוסף.
- polling של Orders/Kupa עבר ל־12–14 שניות עם jitter.
- refresh token הוא Promise יחיד בתוך app. Web Lock קצר מצמצם refresh כפול בין tabs, ותחת ה־lock נקרא session מחדש.
- איחוד ארבעת version polls ל־`get_sync_versions()` נשאר P2; correctness אינו תלוי בו.

## 8. Calendar ו־multi-tab

- OAuth callback המוקדם נשמר.
- restore remembered connection, token refresh, background sync, visibility/online reconnect מותנים ב־primary tab, למעט פעולה מפורשת של משתמש במסך Calendar.
- Edge Function ממפה Data API 502/503/504/PGRST002/PGRST003 ל־HTTP 503 עם `calendar_data_api_unavailable`.
- client Calendar משתמש ב־bounded recovery של 15/30/60/120 שניות.
- fallback ללא Web Locks משתמש ב־BroadcastChannel וב־lease heartbeat פג־תוקף ב־localStorage. גם split-brain קצר נשאר בטוח באמצעות revisions, advisory locks ו־outbox.

## 9. migrations חדשים

1. `netunim-orders/supabase/cloud_sync_lossless_v3_upgrade.sql`
2. `netunim-kupa/supabase/cloud_sync_lossless_v3_upgrade.sql` — byte-identical לעותק Orders.
3. `netunim-orders/supabase/google_calendar_oauth_states_owner_index_upgrade.sql` — index concurrent ל־FK `owner_id`, מחוץ ל־transaction.

Migration v3 הוא additive ו־backward-compatible:

- מוסיף private ledger `netunim_internal.document_sync_operations` ל־Orders/Kupa/Checks/Finance עם owner/domain/document/operation id, payload SHA-256, applied revision, RLS ו־REVOKE/GRANT מפורשים.
- מוסיף private ledger `netunim_internal.bank_sync_operations` עם RLS ו־REVOKE/GRANT מפורשים.
- מוסיף RPCs בעלי שמות ייחודיים `save_*_v3` במקום function overloading, כדי להימנע מעמימות PostgREST; ה־RPCs הישנים נשארים לתאימות בפריסה.
- משדרג רק branch מפורש של `revision_conflict` ל־`PT409`; stale bank watermark נשאר `40001` עם semantics נפרד.
- מחליף את private Finance/Bank functions; ה־public SECURITY INVOKER wrappers נשארים ללא שינוי.
- משמר את ה־financial gate ואת `lock_timeout=100ms`.
- שולח `NOTIFY pgrst, 'reload schema'`.
- אינו מריץ מחדש `setup.sql` ואינו נוגע בנתוני production קיימים מלבד seed בטוח של token קיים ללדג'ר החדש.

לא הוגדר `statement_timeout` ללא מדידה. `cloud_sync_v3_benchmark.sql` מפיק P50/P95/P99/MAX ו־5×P99 עבור כל writer בתוך transaction שמתבצע עליו rollback.

## 10. בדיקות fault/stress דטרמיניסטיות שבוצעו

`node --test tests/cloud_sync_faults.test.mjs`:

```text
15 tests; pass 15; fail 0
v2/marker migration + exact ACK                         PASS
machine-readable error classification                   PASS
busy policy: same operation, exactly three attempts     PASS
single lane + poll coalescing + bounded read starvation PASS
in-flight identical poll remains coalesced              PASS
503 storm: one backend request + one recovery probe     PASS
lost ACK + intervening writer operation replay          PASS
Orders: 50 rapid mutations                              PASS
Kupa: 50 rapid mutations                                PASS
ACK N cannot clear N+1                                  PASS
100 offline mutations + reload + lost ACK               PASS
six-point crash matrix                                  PASS
Orders 50 + Kupa 50 concurrently                        PASS
bank token/archive replay                               PASS
Shared Checks cross-app merge/conflict                  PASS
```

תוצאות מהותיות:

- 50 Orders mutations ו־50 Kupa mutations הסתיימו ב־canonical final state מלא, עם coalescing וללא צורך ב־50 RPCs.
- 100 שינויים offline שרדו serialization/reload; lost ACK הפך ל־no-op replay וה־outbox התרוקן רק אחרי ACK מתאים.
- breaker storm עם 30 callers הפעיל backend request אחד בתקופת הכשל, probe יחיד אחרי expiry, ו־429 לא פתח breaker.
- שינוי Check A מ־Orders ושינוי Check B מ־Kupa מוזגו; שינוי סותר באותו Check נשמר כ־conflict מפורש בלי silent overwrite.
- crash לאחר durable commit בכל נקודת המטריצה נמצא ב־restart והמשיך recovery.

`node --test tests/tab_lock_fallback.test.mjs`:

```text
Orders fallback elects one writer PASS
Kupa fallback elects one writer   PASS
2 tests; pass 2; fail 0
```

`python tests/runtime_sync_multitab.py` (Chromium אמיתי):

```json
{"secondaryGuard":true,"calendarBackendRequests":0,"dataApiRequests":0}
```

`python tests/runtime_sync_recovery.py`:

```text
Kupa: offline pending persisted; recovery revision 6; disjoint merge succeeds;
same-record conflict explicit; busy retry uses 2 calls; final revision 12.
Orders: offline pending + pending state persisted; recovery revision 6;
disjoint merge succeeds; same-record conflict explicit; busy retry uses 2 calls;
final revision 12.
```

## 11. בדיקות קיימות ותוצאות

Baseline לפני שינוי:

```text
python tests/run_all.py                         PASS
python tests/static_contracts.py                PASS
python tests/runtime_sync_recovery.py           PASS
node tests/sync_models.test.mjs                 PASS
node tests/storage_models.test.mjs              PASS
node tests/bank_archive_transport.test.mjs      PASS
python tools/sync-assets.py --check             PASS
npm run lint                                    PASS
```

בדיקות ה־v3 לאחר השינוי:

```text
python tests/run_all.py                              ALL VERIFICATION SUITES PASSED
python tests/cloud_sync_v3_contracts.py          23 PASS / 0 errors
node --test tests/cloud_sync_faults.test.mjs     13 PASS / 0 fail
node --test tests/tab_lock_fallback.test.mjs      2 PASS / 0 fail
python tests/runtime_sync_multitab.py            PASS; 0 background requests
python tests/bank_bridge_contracts.py            PASS
python tests/calendar_contracts.py               PASS
python tests/static_contracts.py                 PASS; 0 errors
python tools/sync-assets.py --check               PASS
npm run lint                                     PASS
git diff --check                                 PASS
```

הבדיקות החדשות משולבות ב־`tests/run_all.py` דרך `module_contracts.py` ודרך runtime suite; הן אינן בדיקות צדדיות בלבד.

## 12. מדידות

### מדידות שבוצעו מקומית

`python tests/runtime_performance.py`:

```text
Kupa:   1000-row render x8; max 160ms; mean 130ms; writes 0; requests 0
Orders: 1000-row render x8; max 632ms; mean 483ms; writes 0; requests 0
```

אלו מדידות browser/render, לא RPC latency.

### מדידות production read-only שנאספו לפני השינוי

- Supabase project היה `ACTIVE_HEALTHY`, PostgreSQL 17.6.
- גדלי documents שנצפו: Orders כ־335KB, Kupa כ־3KB, Shared Checks כ־14KB, Finance כ־650KB.
- נצפו ארבעה meta polls נפרדים בערך כל 12 שניות.
- לא הורץ benchmark כותב על production.

### מדידות שממתינות ל־staging

RPC P50/P95/P99/MAX, `pg_stat_activity`, lock waits, PGRST002/PGRST003 והתנהגות pool תחת עשרות calls **לא נמדדו**, משום שאין בפרויקט שסופק credentials של staging ייעודי והדרישה אוסרת stress על production. לכן:

- אין טענה ש־server-side load acceptance הושלם.
- אין `statement_timeout` שנבחר לפי תחושה.
- `netunim-orders/supabase/shared/validation/cloud_sync_v3_benchmark.sql` מוכן למדידה עם rollback.
- `tools/cloud-sync-staging-stress.mjs` מוכן לעומס HTTP ומסרב קשיח ל־production ref הידוע.

הרצה ללא staging נעצרה כמצופה:

```text
STAGING STRESS REFUSED: set NETUNIM_STAGING_CONFIRM=staging-only
```

## 13. מטריצת אינווריאנטים וקבלה

| אינווריאנט | ראיה | סטטוס |
|---|---|---|
| אין אובדן ב־rapid saves / in-flight save | 50 Orders + 50 Kupa + generation rebase | הוכח מקומית |
| אין אובדן ב־429/conflict/outage/timeout/offline | fault models + recovery runtime | הוכח מקומית |
| reload/crash אחרי durable commit | 6-point crash matrix + 100 offline | הוכח מקומית |
| lost ACK אינו מכפיל side effect | document/bank/archive replay models + SQL contracts | הוכח במודל ובחוזה; staging SQL ממתין |
| ACK ישן אינו מוחק דור חדש | exact generation test | הוכח מקומית |
| Orders ו־Kupa אינם חולקים lock | SQL contract + concurrent model | הוכח מבנית ובמודל; live staging ממתין |
| Shared Checks A+B נשמרים | cross-app merge test | הוכח מקומית |
| same-check conflict אינו silent overwrite | fail-closed test | הוכח מקומית |
| outage אינו יוצר request storm | 30-caller breaker test | הוכח מקומית |
| secondary Calendar אינו יוצר traffic | Chromium runtime: 0/0 requests | הוכח בדפדפן |
| Web Locks unavailable נשאר safe | dual-app fallback tests | הוכח במודל |
| אין lock convoy / pool exhaustion | נדרש `pg_stat_activity` ב־staging | ממתין ל־staging |
| RPC P50/P95/P99/MAX | benchmark מוכן | ממתין ל־staging |
| `statement_timeout >= 5×P99` | ייקבע רק אחרי מדידה | ממתין ל־staging |

## 14. תחזוקה משנית

- נוסף migration נפרד ל־covering index של `google_calendar_oauth_states(owner_id)`; יש לאמת plan ב־staging לפני production.
- לא נוספו policies אוטומטיות ל־`google_calendar_connections` או `google_calendar_oauth_states`; יש לוודא שהן אכן Edge/service-role only.
- leaked-password protection נשאר המלצת Auth נפרדת; לא שונה במסגרת sync.
- לא נמחקו indexes שסומנו unused, משום שהם עשויים לשמש retention/backup paths.
- housekeeping של backup retention נשאר בתוך transaction. העברתו ל־maintenance היא P2 ורק אם benchmark יצדיק זאת; previous-state backup האטומי לא ייצא מה־transaction.

## 15. קבצים ששונו/נוספו

### Shared/client infrastructure

- `shared/cloud-sync.js`
- `netunim-orders/site/assets/js/shared/cloud-sync.js`
- `netunim-kupa/site/assets/js/shared/cloud-sync.js`

### Orders

- `netunim-orders/site/assets/js/calendar/auth.js`
- `netunim-orders/site/assets/js/cloud/auth.js`
- `netunim-orders/site/assets/js/cloud/transport.js`
- `netunim-orders/site/assets/js/domains/calendar/controller.js`
- `netunim-orders/site/assets/js/domains/finance/controller.js`
- `netunim-orders/site/assets/js/lifecycle.js`
- `netunim-orders/site/assets/js/main.js`
- `netunim-orders/site/assets/js/storage/browser.js`
- `netunim-orders/site/assets/js/storage/checks.js`
- `netunim-orders/site/assets/js/storage/tab-lock.js`
- `netunim-orders/site/assets/js/sync/checks.js`
- `netunim-orders/site/assets/js/sync/document.js`
- `netunim-orders/site/assets/js/ui/cloud.js`
- `netunim-orders/site/service-worker.js`
- `netunim-orders/supabase/CLOUD_SETUP.txt`
- `netunim-orders/supabase/functions/google-calendar-oauth/index.ts`
- `netunim-orders/supabase/cloud_sync_lossless_v3_upgrade.sql`
- `netunim-orders/supabase/google_calendar_oauth_states_owner_index_upgrade.sql`
- `netunim-orders/supabase/shared/validation/cloud_sync_v3_benchmark.sql`
- `netunim-orders/supabase/shared/validation/cloud_sync_v3_server_contracts.sql`

### Kupa

- `netunim-kupa/site/assets/js/cloud/auth.js`
- `netunim-kupa/site/assets/js/cloud/transport.js`
- `netunim-kupa/site/assets/js/lifecycle.js`
- `netunim-kupa/site/assets/js/main.js`
- `netunim-kupa/site/assets/js/storage/pending.js`
- `netunim-kupa/site/assets/js/storage/tab-lock.js`
- `netunim-kupa/site/assets/js/sync/checks-state.js`
- `netunim-kupa/site/assets/js/sync/checks.js`
- `netunim-kupa/site/assets/js/sync/document.js`
- `netunim-kupa/site/assets/js/sync/pending.js`
- `netunim-kupa/site/assets/js/sync/recovery.js`
- `netunim-kupa/site/assets/js/ui/cloud.js`
- `netunim-kupa/site/service-worker.js`
- `netunim-kupa/supabase/CLOUD_SETUP.txt`
- `netunim-kupa/supabase/cloud_sync_lossless_v3_upgrade.sql`

### Tests/tools/report

- `tests/calendar_contracts.py`
- `tests/cloud_sync_faults.test.mjs`
- `tests/cloud_sync_v3_contracts.py`
- `tests/cross_app_finance_freshness.test.mjs`
- `tests/module_contracts.py`
- `tests/run_all.py`
- `tests/runtime_sync_multitab.py`
- `tests/static_contracts.py`
- `tests/tab_lock_fallback.test.mjs`
- `tools/cloud-sync-staging-stress.mjs`
- `CLOUD_SYNC_V3_REPORT.md`

## 16. הוראות deployment מדויקות

אין לדלג על staging:

1. ליצור staging project נפרד עם schema ו־fixtures אנונימיים מ־production.
2. לשמור dump של הגדרות כל ה־RPCs המוחלפים ושל revisions/counts.
3. להחיל ב־staging את `cloud_sync_lossless_v3_upgrade.sql` פעם אחת. אין להריץ `setup.sql`.
4. לאמת schema reload, ownership, RLS ו־REVOKE/GRANT.
5. להריץ:

   ```text
   psql ... -v owner_id='<dedicated-staging-user>' -f netunim-orders/supabase/shared/validation/cloud_sync_v3_server_contracts.sql
   psql ... -v owner_id='<dedicated-staging-user>' -f netunim-orders/supabase/shared/validation/cloud_sync_v3_benchmark.sql
   ```

6. להגדיר את משתני `NETUNIM_STAGING_*`, כולל `NETUNIM_STAGING_CONFIRM=staging-only`, ולהריץ:

   ```text
   node tools/cloud-sync-staging-stress.mjs
   ```

7. לאשר P50/P95/P99/MAX, 429 מהיר, היעדר lock waits ארוכים, היעדר PGRST002/PGRST003, ו־Orders+Kupa בו־זמנית.
8. רק לאחר המדידה ליצור migration נוסף ל־`statement_timeout` לפי `>=5×P99` עם margin; לא לערוך את migration v3 שכבר נבדק.
9. להריץ explain/query-plan ל־calendar owner FK; אם מוצדק, להחיל בנפרד את ה־index migration concurrent.
10. לפרוס את Calendar Edge Function ולבדוק 503 סמנטי ב־staging.
11. להריץ מקומית/CI:

    ```text
    python tools/sync-assets.py
    python tools/sync-assets.py --check
    npm run lint
    python tests/run_all.py
    ```

12. לוודא Service Worker hash/cache name חדש בשני האתרים.
13. ב־production: להחיל קודם את migration השרת, לאמת smoke עם client ישן, ורק אז לפרוס Orders ו־Kupa החדשים.
14. לבצע smoke אמיתי עם משתמש בדיקה: שינוי Orders, שינוי Kupa במקביל, Checks שונים משני האתרים, offline/reload/reconnect, lost-response באמצעות proxy, וטאב Orders משני.
15. לנטר 429/409/5xx, PGRST002/PGRST003, RPC latency ו־pending recovery במשך חלון הפריסה.

## 17. Rollback plan

1. אם client regression מופיע, להחזיר קודם את שני clients ואת Service Workers לגרסה הקודמת. migration השרת backward-compatible ולכן בטוח יותר להשאיר אותו.
2. לא למחוק את `document_sync_operations` או `bank_sync_operations` כל עוד client v3 או outbox v3 עשוי לבצע replay.
3. אם נדרש rollback DB: לעצור client v3, לשחזר את private function definitions מה־dump שלפני הפריסה, להשאיר את ledger read-only לשימור audit, ואז לבצע schema reload.
4. `PT409` נשאר backward-compatible באמצעות message `revision_conflict`; client ישן ממשיך לזהות אותו.
5. אין rollback נתונים אוטומטי ואין decrement revisions. אם נדרש שחזור business state, להשתמש בגיבויי ה־previous-revision הקיימים תחת runbook נפרד ובאישור אנושי.
6. index של Calendar ניתן להסרה ב־`DROP INDEX CONCURRENTLY` רק אם plan/production monitoring מצדיקים זאת; בדרך כלל אין צורך להחזירו.
7. אחרי rollback להריץ smoke של Orders/Kupa/Checks/Finance ולאמת שאין pending שנשאר ללא worker פעיל.

## 18. מסקנת קבלה

כל תנאי ה־client correctness, recovery, multi-tab, Calendar traffic ו־request-storm שניתן להוכיח ללא כתיבה לשרת production הוכח בבדיקות דטרמיניסטיות וב־Chromium אמיתי. הקוד מוכן לשלב staging.

אין לאשר deployment production כ־“הושלם” לפני השלמת שלושת התנאים התפעוליים שנותרו: SQL contracts ב־staging, benchmark P50/P95/P99/MAX, ו־concurrency/`pg_stat_activity` ללא convoy או pool exhaustion. הדוח משאיר אותם גלויים בכוונה ואינו מציג בדיקות שלא בוצעו כאילו עברו.

## 19. Hardening סופי לאחר Production Verification — 2026-09-03

השינויים בסבב זה הם additive וממוקדים. לא שוכתבה הארכיטקטורה, לא שונו migrations קודמים, לא הורץ `setup.sql`, לא בוצעה כתיבה ל־production ולא שונו business documents.

### Durable not-before ו־operationId

- `retry.nextAttemptAt` נאכף כעת על ידי primitive משותף לפני כל recovery של Orders, Kupa ושני מסלולי Shared Checks.
- generic HTTP 429 נשמר ל־outbox כבר בכשל הראשון יחד עם `Retry-After`; wrapping של שגיאת RPC אינו מאבד עוד status/header/retry metadata.
- reload או runtime חדש טוען את ה־timestamp מה־outbox ואינו מבצע backend access של אותו writer לפני המועד.
- לכל writer יש לכל היותר timer אחד; generation חדש מחליף את timer הישן ואינו עוקף את ה־not-before.
- snapshot חדש נשמר מיד כ־generation חדש. הוא מקבל operationId חדש אך יורש רק not-before עתידי; attempts ושגיאות של הדור הקודם אינם מועתקים.
- `crypto.randomUUID()` משמש כאשר הוא זמין. fallback timestamp/random נשמר לסביבות ישנות וניתן להזרקה דטרמיניסטית בבדיקות.
- ACK עדיין מנקה רק generation זהה; ACK ישן אינו מוחק generation חדש יותר.

### Retention policy ו־maintenance

- maximum supported offline/recovery horizon מוגדר ל־365 ימים.
- ledger retention מוגדר ל־730 ימים — פי שניים מאופק ההתאוששות הנתמך.
- defense in depth משאיר לפחות 100 operations אחרונות לכל `owner/domain/document`; ב־Bank החלוקה היא `owner/document`.
- כל invocation מוחק לכל היותר 10,000 רשומות מכל ledger, מחוץ ל־user write path.
- `netunim_internal.prune_sync_operation_ledgers()` אינה מקבלת `owner_id`, cutoff או פרמטר לקוח אחר.
- הפונקציה היא `SECURITY DEFINER` עם `search_path` נעול. `EXECUTE` ניתן רק ל־`service_role`; `anon` ו־`authenticated` נשללו במפורש, וגם `DELETE/TRUNCATE` על שתי טבלאות ה־ledger נשלל מהם.
- המיגרציה רק מתקינה את primitive. היא אינה מריצה cleanup ואינה יוצרת schedule. schedule שבועי יתווסף רק לאחר review תפעולי.
- לא נוסף index: אין סביבת staging זמינה להרצת `EXPLAIN (ANALYZE, BUFFERS)`, והנפח הנוכחי אינו מצדיק ניחוש. ההחלטה נשארת תלויה במדידה.

המיגרציה הנפרדת נמצאת בשני האתרים והיא byte-identical:

- `netunim-orders/supabase/cloud_sync_operation_ledger_retention_upgrade.sql`
- `netunim-kupa/supabase/cloud_sync_operation_ledger_retention_upgrade.sql`

חוזה staging חדש: `netunim-orders/supabase/shared/validation/cloud_sync_v3_ledger_retention_contracts.sql`. הוא בודק הרשאות, fresh rows, keep floor, אי־נגיעה במסמכי business, replay, `PT422` והמשך פעולת ארבעת RPCs; כל השינויים עטופים ב־transaction עם `ROLLBACK`.

### תוצאות בדיקות הסבב

```text
node --test tests/cloud_sync_faults.test.mjs     18 pass / 0 fail
python tests/cloud_sync_v3_contracts.py          42 pass / 0 errors
python tests/run_all.py --core-only              ALL CORE VERIFICATION SUITES PASSED
python tests/run_all.py                          ALL VERIFICATION SUITES PASSED
python tools/sync-assets.py --check              PASS
git diff --check                                 PASS
```

בדיקת ה־Retry-After החדשה מדמה 429 עם 60 שניות, serialization של IndexedDB, runtime חדש, recovery ב־T+10 וב־T+59 עם 0 backend requests, request יחיד ב־T+60, ACK וניקוי generation מדויק. וריאנט נוסף יוצר generation חדש בתוך החלון ומוכיח שה־cloud state הסופי הוא ה־snapshot החדש ביותר ללא request מוקדם. בדיקה נוספת מוכיחה timer יחיד והחלפתו בעת generation חדש.

ה־full gate כלל static contracts, Cloud Sync v3, fault injection, sync/business/storage models, cross-app finance, module graph, Bank Bridge, Calendar, Calendar OAuth backend, Service Worker, deploy preflight, sync-assets וכל 12 סוויטות Chromium runtime, כולל sync recovery ו־multitab.

### Staging ו־statement_timeout

לא קיימים בסביבה משתני `NETUNIM_STAGING_*` או credentials ל־staging ייעודי. לכן לא הורץ stress על production ולא הומצאו מדדי שרת. P50/P95/P99/MAX, PT409/PT429 תחת עומס, lock waits, PostgREST sessions/pool waiters ו־PGRST002/PGRST003 הם **לא נמדדו בסבב זה**.

החלטה: אין להוסיף כעת `statement_timeout`, אין לפצל את `netunim_financial_write` advisory gate ואין להוסיף index ל־cleanup. החלטות אלה ייפתחו מחדש רק לאחר benchmark staging אמיתי.

### Rollback של hardening זה

1. client rollback: לפרוס יחד את גרסאות Orders/Kupa וה־Service Workers הקודמות. ה־outbox נשאר backward-compatible; אין למחוק pending או ledgers.
2. maintenance rollback לפני הרצה ראשונה: `REVOKE EXECUTE ... FROM service_role; DROP FUNCTION netunim_internal.prune_sync_operation_ledgers();`. אין צורך לשנות business data.
3. אם cleanup כבר רץ, מחיקת acknowledgements ישנים אינה הפיכה ללא backup; לכן יש לגבות ledgers לפני ההפעלה הראשונה. operations חדשות ו־100 האחרונות לכל partition אינן אמורות להימחק לפי החוזה.
4. אין להחזיר migrations קודמים, אין למחוק ledgers ואין לבצע decrement ל־revisions.
