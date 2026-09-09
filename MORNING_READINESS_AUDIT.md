**בדיקת מוכנות Morning → חובות לקוחות — 9 בספטמבר 2026**

**החלטה: אין אישור לשימוש בייצור כרגע.** כל 18 חבילות ה-core וכל 14 חבילות ה-runtime עברו, כולל `runtime_morning.py` המורחב. עם זאת, בדיקה נוספת שחוצה שני מחשבים חשפה קיזוז כפול סמנטי שעדיין אפשרי. הצלחת השער אינה מבטלת את הממצא הזה.

**בטיחות הנתונים והיקף הבדיקה**

הבדיקות פעלו על עותקי אתר זמניים, פרופילי Chromium נפרדים, LocalStorage/IndexedDB של הבדיקות בלבד, ו-PostgreSQL מקומי שנוצר בתיקיית TEMP עם פורט מקומי אקראי. תשתית PostgreSQL מסירה משתני חיבור סביבתיים ואינה מקבלת URL של שרת חיצוני. פרופיל הדפדפן האישי, החובות האמיתיים, מפתחות Morning ונתוני Supabase לא שימשו לבדיקות. לא הופק מסמך אמיתי ולא בוצעו פריסה או migration בשרת שלך.

Morning הודמה בתעבורה מבוקרת; בדיקות Edge מפעילות את קוד השרת עם API ויומן מדומים. בדיקות SQL מפעילות PostgreSQL אמיתי. במבחני שני המחשבים, שני פרופילים אמיתיים מפעילים את ה-outbox, השמירה והמיזוג של היישום, מול תעבורת CAS מדומה. אין בכך אישור לתאימות שירות Morning החי, להרשאות הפרויקט החי או לתצורת המפתחות הנוכחית. ב-Windows, pg_cron מיוצג בקטלוג תזמון מדומה; לא נבדקה הרצת worker אמיתי שלו.

**תקלות אמיתיות והשרשרת הסיבתית**

1. **תוקן — קיזוז כפול באותו דפדפן לאחר reload.** הפקת 320 של 30 ₪ נשארה `needs_reconciliation`; העורך התיר הוספת תשלום ידני של 30 ₪; reconciliation הוסיף אירוע Morning נוסף. בפועל התקבלו 60 ₪ ששולמו על חוב של 100 ₪. נוספה נעילה כספית זמנית לפי `debtId`, לרבות מחיקה יחידה ומרובה. ההערות, supplied וחובות אחרים נשארים זמינים. הנעילה נבדקת גם בזמן השמירה ולא רק בהצגת שדות disabled. [הוכחת הכשל המקורי](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-gap-proof.log>).
2. **תוקן — שחרור הפקה למרות כשל בניקוי Recovery.** `resetOperationAfterTerminal` התעלם מתוצאת `clearRecoveryContext`, החליף operation ID ואיפשר הפקה חדשה. התקבל בפועל `recoveryRemains=True` לצד `newIssueEnabled=True`. כעת ניסיון failed או reserved נשאר נעול עד שניקוי Recovery מצליח, כמו מסמך created. [הוכחת כשל הניקוי](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-terminal-proof.log>).
3. **תוקן — קונפליקט שווא על זמן בלבד.** מיזוג השווה את כל תוכן האירוע, כולל `createdAt`. אותו ID ואותו סכום שהגיעו בזמני אימות שונים גרמו לקונפליקט. כעת רק ההשוואה העסקית מתעלמת מהזמן; אירוע קיים בבסיס נשאר ללא שינוי, ולשתי גרסאות חדשות נבחר זמן מוקדם באופן דטרמיניסטי. סכום/סוג/מקור/פעולה שונים באותו ID עדיין גורמים לקונפליקט. [רגרסיה שנכשלה לפני התיקון](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-timestamp-proof.log>).
4. **תוקן — save מיותר על replay שכבר נשמר.** העורך קרא ל-scheduleSave בכל `already-applied`, גם לאחר שמירה מוצלחת. נוסף זיכרון מקומי של מצב החוב שנשמר בהצלחה. כפילות זהה אינה מבצעת save/render; לאחר כשל בשמירה או אובדן הזיכרון ב-reload מתבצע persistence מחדש. אין הסתמכות על הזיכרון הזה במקום שמירה עמידה.
5. **תוקן — אובדן נקודת ההתאוששות כאשר החוב חסר.** מחיקה ממקור אחר לפני reconciliation הובילה ל-`missing-debt`, שהוגדר כתוצאה בטוחה וניקה Recovery למרות שלא נרשם תשלום או חשבונית. הוסר מסיווג הסיום הבטוח. כעת Recovery נשמר, והחזרת החוב המקורי מאפשרת להשלים את הרישום פעם אחת. [הוכחת הכשל לפני התיקון](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-boundary-proof.log>).
6. **פתוח — קיזוז כפול סמנטי בין שני מחשבים.** A מפיק 320 של 30 ₪ ונשאר עם Recovery מקומי. B, שאין אצלו אותו LocalStorage, רושם ידנית את אותו תשלום של 30 ₪. המיזוג תקין מבחינת IDs ואין בו קונפליקט. לאחר reconciliation ב-A מתקבלים שני אירועים שונים וסך 60 ₪ ששולמו. זהו כשל עסקי, לא כפל POST ולא overwrite. הנעילה המקומית שנוספה אינה יודעת להגן על מחשב B. [שחזור במחשבים מבודדים](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-boundary-proof.log>); [סקריפט ההוכחה](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning_boundary_probe.py>).

נדרש שינוי נוסף בתכנון התיאום בין מחשבים לפני אישור ייצור: נעילה זמנית משותפת עם הגנה גם על עריכות שהצטברו offline, או מנגנון הכרעה מפורש שמזהה שינוי כספי בזמן המתנה ואינו מנחש לפי סכומים. אין כאן הצעה לקזז אוטומטית אירועים שווי סכום. בבדיקה הזאת לא נוספו טבלה או קשר קבוע למסמכי Morning; לא הוכנס שינוי בפרוטוקול הסנכרון כדי להסוות את המגבלה.

**תוצאות שער הפריסה — `python tests/run_all.py`**

השער הקיים עבר גם בהרצה הראשונית, ולכן הבדיקות החדשות חשובות: התקלות לא כוסו במלואן קודם. הטבלה להלן מתייחסת להרצה המלאה על קוד הייצור המתוקן. [לוג מלא סופי](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-audit-final-v2.log>).

| suite | קבוצה | תוצאה |
|---|---|---|
| `supabase_contracts.py` | core | PASS |
| `supabase_candidate.py` | core | PASS |
| `supabase_retention.py` | core | PASS |
| `static_contracts.py` | core | PASS |
| `cloud_sync_v3_contracts.py` | core | PASS |
| `sync_integrity_v5_contracts.py` | core | PASS |
| `offline_dependencies_contracts.py` | core | PASS |
| `confirmation_contracts.py` | core | PASS |
| `cloud_backup_contracts.py` | core | PASS |
| `asset_contracts.py` | core | PASS |
| `deploy_preflight.py` | core | PASS |
| `service_worker_contracts.py` | core | PASS |
| `module_contracts.py` | core | PASS |
| `calendar_contracts.py` | core | PASS |
| `morning_documents_contracts.py` | core | PASS |
| `morning_edge_contracts.py` | core | PASS |
| `morning_ledger.py` | core | PASS |
| `bank_bridge_contracts.py` | core | PASS |
| `runtime_smoke.py` | runtime | PASS |
| `runtime_responsive.py` | runtime | PASS |
| `runtime_calendar.py` | runtime | PASS |
| `runtime_events.py` | runtime | PASS |
| `runtime_security.py` | runtime | PASS |
| `runtime_workflows.py` | runtime | PASS |
| `runtime_morning.py` | runtime | PASS |
| `runtime_pwa.py` | runtime | PASS |
| `runtime_performance.py` | runtime | PASS |
| `runtime_data_integrity.py` | runtime | PASS |
| `runtime_sync_recovery.py` | runtime | PASS |
| `runtime_sync_multitab.py` | runtime | PASS |
| `runtime_sync_two_computers.py` | runtime | PASS |
| `runtime_financial.py` | runtime | PASS |

**הרצות נפרדות**

| בדיקה | תוצאה | ראיה |
|---|---|---|
| `python tests/morning_ledger.py` ב-PostgreSQL מבודד, כולל שתי הכנסות מקבילות | PASS | [לוג](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-ledger-independent.log>) |
| `python tests/supabase_candidate.py` ב-PostgreSQL מבודד | PASS | [לוג](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-candidate-independent.log>) |
| `python tests/supabase_retention.py` ב-PostgreSQL מבודד | PASS — 3 tests | [לוג](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-retention-independent.log>) |
| מודלי חובות/Morning/Recovery | PASS — 33 tests; נבדקו שוב כחלק מהשער | [לוג המודלים](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-audit-models.log>) |
| `node tests/morning_edge.test.mjs`, כולל מרוץ בין משתמשים שונים | PASS | [לוג Edge](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-edge-independent.log>) |
| קריסה לפני POST, קריסה לפני persistence, חוב שנמחק ממקור אחר | PASS | [לוג דפדפן](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-crash-runtime.log>) |
| רישום ידני של אותו תשלום ב-B בזמן Recovery ב-A | **FAIL — נשאר פתוח** | [הוכחה: 30 הפך ל-60](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-boundary-proof.log>) |

**תרחישי Morning, קריסה וסנכרון**

| תרחיש | תוצאה סופית | אופן האימות |
|---|---|---|
| 320 על מלוא החוב: תשלום וחשבונית נסגרים פעם אחת | PASS | Chromium + מודל |
| 400: תשלום בלבד | PASS | Chromium + מודל |
| 305: חשבונית בלבד | PASS | Chromium + מודל |
| מסמכים חלקיים בכמה פעימות ויתרה בכל שלב | PASS | Chromium: 320/400/305 ברצף |
| מסמך מעל היתרה, ללא יתרה שלילית | PASS | Chromium + מודל |
| תשלום ידני קיים, 320, זקיפה כתשלום כבויה | PASS | Chromium: נשאר תשלום ידני יחיד; חשבונית מתווספת |
| חשבונית ידנית קיימת, 320, זקיפה כחשבונית כבויה | PASS | Chromium: נשארת חשבונית ידנית יחידה; תשלום מתווסף |
| operation_id חוזר מ-create ומ-reconciliation | PASS | אין אירוע/save/render נוסף אחרי שמירה מוצלחת |
| Reset לאחר אירוע Morning ואז replay | PASS | האירוע נשאר בהיסטוריה, אינו מופעל מחדש |
| קריסה אחרי server reserve ולפני POST | PASS | snapshot משוחזר; abandon בלבד, ללא create וללא שינוי חוב; Edge בודק גם reservation מיושן ללא Recovery מקומי |
| POST עם תשובה אבודה | PASS | UI אינו שולח create נוסף; Edge אינו מבצע POST נוסף לפני reconciliation |
| אימות מוצלח לפני persistence שנכשל | PASS | replay בזיכרון שומר מחדש; reload מאבד זיכרון ומשחזר פעם אחת מתוך Recovery |
| removeItem נכשל בניקוי Recovery | PASS | created, failed ו-reserved נשארים נעולים; ניסיון ניקוי חוזר מצליח |
| תוצאת יישום חדשה ולא מוכרת | PASS | Recovery נשאר; ההפקה נעולה |
| שתי לשוניות: Secondary ו-Primary | PASS | שתי לשוניות אמיתיות; רק הראשית מפיקה, גם בהפקה עצמאית |
| איבוד ownership בזמן חלון האישור | PASS | נעצר לפני reserve ו-create |
| פתיחת חוב אחר כשיש Recovery | PASS | אין שיוך מחדש; התוכן השמור לא משתנה |
| A מוסיף תשלום חלקי ו-B מוסיף תשלום אחר | PASS | שני פרופילים, outbox אמיתי ו-CAS מדומה; שני האירועים נשמרים |
| Reset ב-A ותשלום חדש ב-B | PASS | התשלום החדש נשמר; בוטלו רק IDs שה-Reset הכיר |
| שתי פעולות Morning שונות לאותו חוב | PASS | ארבעה אירועים, שתי יתרות מוגבלות לאפס, ללא אובדן האירועים |
| בקשות זהות במקביל | PASS | מרוץ Edge בין operation IDs ומשתמשים שונים + INSERT מקביל ב-PostgreSQL; POST אחד בלבד |
| needs_reconciliation, reload, ניסיון שינוי סכום/תשלום/חשבונית/paid/invoiceIssued/מחיקה באותו דפדפן | PASS אחרי התיקון | החוב נשאר נעול; הערות/supplied וחוב אחר זמינים; הנעילה משתחררת רק בסיום בטוח |
| אותה פעולה, אבל הרישום הידני נעשה במחשב אחר | **FAIL** | הוכח קיזוז סמנטי כפול; חסם ייצור |
| אירועים קיימים append-only | PASS | עריכה עסקית באירוע קיים גורמת לקונפליקט; Reset מוסיף אירוע עם IDs מפורשים |
| אותו ID ותוכן עסקי שונה | PASS | קונפליקט; מסלול הסנכרון שומר את הגרסאות ולא מפרסם את המיזוג החלקי |
| timestamps בלבד | PASS אחרי התיקון | מטא-דאטה של חוב ואירוע אינם יוצרים קונפליקט עסקי |
| סכומי הסיכום | PASS | remaining payment משמש בסיכום הלקוחות ובסיכום הפיננסי המשותף |
| חוב חסר בזמן reconciliation | PASS אחרי התיקון | Recovery נשמר עד החזרת החוב והשלמת הרישום |

**האם נמצאה דרך לייצר את הסיכונים שהוגדרו?**

| סיכון | מסקנה מפורשת |
|---|---|
| מסמך Morning כפול | לא נוצר כפל POST במרוצי operation ID/fingerprint שנבדקו. לפני התיקון כשל cleanup איפשר להתחיל פעולה חדשה בעוד Recovery קיים; המסלול תוקן. operation ID חדש לאחר השלמת פעולה קודמת עדיין יכול להפיק ביודעין מסמך עם אותו תוכן — ה-fingerprint אינו איסור תמידי על מסמכים זהים. |
| קיזוז כפול | **כן.** באותו דפדפן תוקן; בין שני מחשבים במקרה של אותו תשלום ידני עדיין אפשרי. |
| אובדן תשלום | נמצא אובדן אפשרות רישום אוטומטי כאשר החוב נמחק ממקור אחר ונוקה Recovery; תוקן. לא נמצא אובדן של אירוע תשלום קיים במרוצי המיזוג שנבדקו. |
| אובדן חשבונית | אותו כשל של חוב חסר חל גם על צד החשבונית ותוקן; לא נמצא אובדן אירוע חשבונית קיים במרוצי המיזוג שנבדקו. |
| מחיקת Recovery מוקדמת | **כן, תוקן במסלול missing-debt.** בכשל removeItem הבעיה הייתה שחרור הנעילה למרות ש-Recovery דווקא נשאר; גם זה תוקן. |
| overwrite במיזוג | לא נמצא overwrite שקט בתרחישים שנבדקו. שינויים עסקיים באותו ID ממשיכים להיחסם; timestamps בלבד מתמזגים. הקיזוז הכפול שנותר הוא איחוד שני IDs שונים ולא overwrite. |

המסקנות מוגבלות לתרחישים ולכשלים המפורטים; אינן הוכחה מתמטית להעדר כל תקלה אפשרית. בפרט, אין אישור בטיחות לעריכה כספית מקבילה מהמחשב השני במהלך Recovery במחשב הראשון.

**הפרדה בין תקלה בייצור לתקלה בבדיקה**

כשל הקיזוז המקומי, כשל cleanup, זמן האירוע וחוב חסר הוכחו לפני שינוי קוד. בחוזה הישן, missing-debt סווג כמותר לניקוי; שיניתי את החוזה רק אחרי שהשחזור הוכיח אובדן Recovery בלי רישום כספי. בדיקת הקריסה החדשה הניחה שרענון לא ישמור זיכרון, אבל pagehide של הייצור שמר אותו; תוקן רק ה-fault injection בבדיקה כדי שגם שמירת pagehide תיכשל. לא הוחלשה שמירת החירום בייצור.

**קבצים ששונו בדיוק**

| קובץ | שינוי |
|---|---|
| [netunim-orders/site/assets/js/domains/customers/bulk.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/domains/customers/bulk.js>) | חסימת מחיקה מרובה של חוב עם Recovery, גם לאחר אישור מחיקה. |
| [netunim-orders/site/assets/js/domains/customers/composition.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/domains/customers/composition.js>) | חיבור בדיקת Recovery לעורך, לטבלה ולמחיקה מרובה. |
| [netunim-orders/site/assets/js/domains/customers/documents.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/domains/customers/documents.js>) | נעילת עריכת חוב; ביטול ניסיון משחרר נעילה רק לאחר ניקוי מוצלח; הודעה במקרה שחוב חסר. |
| [netunim-orders/site/assets/js/domains/customers/editor.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/domains/customers/editor.js>) | חסימת סכום/תשלום/חשבונית/מחיקה; הצגת הנעילה; מניעת שמירה חוזרת מיותרת לאחר persistence מוצלח. |
| [netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js>) | missing-debt אינו נחשב עוד לסיום מקומי בטוח שמאפשר למחוק Recovery. |
| [netunim-orders/site/assets/js/domains/customers/view.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/domains/customers/view.js>) | חסימת שינוי paid/invoiceIssued במהלך Recovery, עם השארת supplied והערות זמינים. |
| [netunim-orders/site/assets/js/sync/merge-records.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/sync/merge-records.js>) | זמן אירוע אינו קונפליקט עסקי; תוכן עסקי שונה באותו ID עדיין נחסם; אירוע בסיס נשמר ללא שינוי. |
| [netunim-orders/site/service-worker.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/service-worker.js>) | עדכון מזהה המטמון באמצעות tools/sync-assets.py עבור הנכסים שהשתנו. |
| [tests/customer_debt_progress.test.mjs](<C:/Users/יעקב/Downloads/pro/netunim/tests/customer_debt_progress.test.mjs>) | רגרסיית זמן שונה לאותו אירוע, דטרמיניזם, שימור אירוע קיים וקונפליקט על סכום שונה. |
| [tests/morning_debt_progress.test.mjs](<C:/Users/יעקב/Downloads/pro/netunim/tests/morning_debt_progress.test.mjs>) | רגרסיה שמוודאת שאין save/render נוסף אחרי replay שכבר נשמר. |
| [tests/morning_debt_recovery.test.mjs](<C:/Users/יעקב/Downloads/pro/netunim/tests/morning_debt_recovery.test.mjs>) | חוזה מתוקן: חוב חסר מחייב שמירת Recovery. |
| [tests/morning_edge.test.mjs](<C:/Users/יעקב/Downloads/pro/netunim/tests/morning_edge.test.mjs>) | שתי בקשות מקבילות, משתמשים ו-operation IDs שונים, fingerprint זהה: POST אחד בלבד. |
| [tests/morning_ledger.py](<C:/Users/יעקב/Downloads/pro/netunim/tests/morning_ledger.py>) | בדיקת INSERT מקביל אמיתי ב-PostgreSQL של אותו fingerprint משני משתמשים. |
| [tests/runtime_morning.py](<C:/Users/יעקב/Downloads/pro/netunim/tests/runtime_morning.py>) | שילוב בדיקות הבטיחות החדשות בתוך runtime_morning.py ובשער הפריסה. |
| [tests/runtime_morning_audit.py](<C:/Users/יעקב/Downloads/pro/netunim/tests/runtime_morning_audit.py>) | תרחישי דפדפן: סוגי מסמכים, חלקי/יתר, opt-out, reload, cleanup, קריסות, לשוניות, שני מחשבים וחוב שנמחק ממקור אחר. |
| [MORNING_READINESS_AUDIT.md](<C:/Users/יעקב/Downloads/pro/netunim/MORNING_READINESS_AUDIT.md>) | דוח זה. |

לוגים וסקריפטים אבחוניים נוספים נמצאים ב-`.work/`. סכמות SQL, נתוני חובות, מסמכי Morning ומפתחות לא שונו. השינויים מקומיים בלבד ולא נפרסו.
