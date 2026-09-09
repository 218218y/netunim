**בדיקת מוכנות Morning → חובות לקוחות — עדכון 9 בספטמבר 2026**

**החסם של מעבר ממחשב A למחשב B וחזרה הוסר בתרחישים שנבדקו.** כל 18 חבילות ה-core וכל 14 חבילות ה-runtime עברו בפקודה `python tests/run_all.py`, כולל PostgreSQL מקומי ובדיקות Chromium. `runtime_morning.py` כולל כעת את בדיקות הבטיחות הקודמות ואת בדיקות ההכרעה החדשות. [לוג שער הפריסה המלא](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-snapshot-release.log>).

**התוצאה העסקית שהוכחה:** A נשאר עם מסמך 320 של 30 ₪ שממתין לאימות; B רושם תשלום ידני של 30 ₪; A חוזר ומקבל את מסמך ההזמנות העדכני מהענן. המערכת נשארת עם 30 ₪ ששולמו, לא מוסיפה אוטומטית את תשלום Morning ומציגה הכרעה. בבחירה מפורשת „לא לזקוף תשלום, כן לזקוף חשבונית”, נשמר התשלום הידני היחיד ומתווספת חשבונית של 30 ₪. לא מתקבל תשלום של 60 ₪ ללא אישור מפורש שזה תשלום נוסף.

**השינוי שיושם**

Recovery חדש של חוב שומר `financialSnapshot` עם חמישה שדות בלבד: `amount`, `paymentApplied`, `invoiceApplied`, `paymentComplete`, `invoiceComplete`. הסכומים מנורמלים לאגורות. אין צילום של כל שורת החוב ואין מסמך Morning, PDF, כתובת, נתוני לקוח או קישור קבוע לענן בתוך הצילום.

לפני זקיפה מתוך Recovery, המערכת ממתינה להשלמת poll או שמירת ענן פעילים, מסיימת סנכרון של שינויים מקומיים קיימים באמצעות ה-outbox וה-CAS הקיימים, ואז מבצעת קריאת GET מלאה חדשה של מסמך ניהול ההזמנות. רק הצלחה מפורשת של הרענון, קליטת המצב ושמירתו המקומית מאפשרות השוואה וזקיפה. כשל רשת, קונפליקט סנכרון, חוב חסר, אובדן בעלות ראשית, revision לא תקין/ישן או שינוי מקומי תוך כדי GET משאירים את ההתאוששות נעולה. התחלת timer או cloudPoll אינה אישור להמשיך.

אם הנתונים הכספיים לא השתנו, היישום ממשיך אוטומטית עם המדיניות שנשמרה בזמן ההפקה. note, supplied ושדות לא כספיים אינם נכללים בהשוואה. אם סכום החוב, התקדמות התשלום או התקדמות החשבונית השתנו, אין ניחוש לפי סכומים: מוצגים סכום המסמך, המצב בזמן ההפקה והמצב הנוכחי, ובחירות עצמאיות בהתאם לסוג המסמך. בצד שהשתנה ברירת המחדל היא לא לזקוף. שינוי amount מכבה כברירת מחדל את שני הצדדים הרלוונטיים.

שינוי תיבות הבחירה שומר טיוטת הכרעה ב-Recovery. לחיצה על אישור מחייבת רענון נוסף; אם החוב השתנה שוב, מוצג המצב החדש ונדרש אישור מחדש. החלטה מאושרת נשמרת מקומית עם צילום המצב שנבדק ו-`confirmedAt` לפני הפעלת מנגנון הזקיפה. לאחר reload היא תקפה רק כל עוד המצב הרלוונטי עדיין תואם. Recovery ישן ללא snapshot דורש הכרעה מפורשת עם ברירות מחדל כבויות. הכרעה פגומה אינה מעניקה הרשאה אוטומטית.

האירועים נכתבים דרך אותו מנגנון קיים, באותם מזהי `MORNING:operation_id:payment/invoice`. בבדיקת replay מושמטים מההשוואה רק אירועי אותה פעולה לפי IDs מדויקים, בלי לשנות אותם ובלי להשמיט אירועים בעלי סכום זהה. כך אירוע שכבר נשמר לפני כשל בניקוי אינו נראה כשינוי כספי חדש ואינו נרשם שוב. מסמך מאומת שחוזר באותה בקשת create לאחר ניתוק/הסתרת הלשונית עובר גם הוא דרך בדיקת ההתאוששות.

לא נוספו shared lock, טבלה, SQL, migration, שינוי Edge Function או שדה חדש במסמך ההזמנות בענן. כל ההרחבה של Recovery וההכרעה נשארת ב-LocalStorage. התיקונים הקודמים נשמרו.

**בדיקות ההמשך המבוקשות**

| תרחיש | תוצאה | ראיה התנהגותית |
|---|---|---|
| A pending, B מוסיף אותו תשלום, A חוזר | PASS | רענון אמיתי של מנגנון היישום מול ענן מדומה מזהה תשלום 30; אין זקיפה אוטומטית נוספת |
| 320: לא לזקוף תשלום, כן לזקוף חשבונית | PASS | נשאר manual payment יחיד של 30; נוסף invoice של 30 בלבד |
| B מוסיף תשלום אחר והמשתמש מאשר תשלום נוסף | PASS | manual 20 + Morning 30 נשמרים כשלושה אירועים נפרדים כולל החשבונית; תשלום כולל 50 |
| B משנה note/supplied בלבד | PASS | אין false positive; השדות נשמרים והמסמך נזקף אוטומטית |
| A חוזר ללא רענון ענן זמין | PASS | GET נכשל: אין זקיפה ואין ניקוי Recovery; GET מוצלח מאוחר יותר משלים |
| GET מסתיים אחרי timer של Recovery | PASS | Promise נשאר בלתי פתור מעבר למועד הטיימר; אין אירוע עד תשובה מוצלחת והשוואה |
| startup בפועל | PASS | לאחר כשל בהידרציה הראשונית, ה-appReady timer מחכה לקריאת הענן הייעודית המאוחרת |
| online ו-visibilitychange בפועל | PASS | אירועי דפדפן אמיתיים לא עוקפים את ה-GET; גם cloudPoll פעיל ממתין להשלמה |
| reload נוסף בזמן ההכרעה | PASS | טיוטת checkbox נשמרת בלי להתאשר אוטומטית; ההכרעה מוצגת שוב |
| קריסה אחרי אישור ולפני היישום | PASS | החלטת invoice-only נשמרת קודם; לאחר reload רק החשבונית מתווספת |
| replay אחרי הכרעה | PASS | אין אירוע נוסף; operation_id ו-IDs נשארו ללא שינוי |
| אישור, כשל ניקוי, שמירה לענן ואז reload | PASS | ההחלטה נשמרת; האירוע של אותה פעולה אינו יוצר קונפליקט שווא או כפילות |
| Recovery ישן בלי snapshot | PASS | 305/400/320 דורשים אישור; כל צד רלוונטי כבוי כברירת מחדל |
| שינוי נוסף בענן בזמן האישור | PASS | אין יישום של החלטה שהתיישנה; מוצג מצב חדש ובחירה בטוחה |
| כשל בשמירת ההכרעה | PASS | אין זקיפה, Recovery נשאר |
| תשובת create מאומתת אך מאוחרת אחרי ניתוק | PASS | גם מסלול זה ממתין לענן ומבקש הכרעה על התשלום שנרשם ב-B |

בדיקות אלה רצות מתוך `runtime_morning.py` בשער המלא. [מקור בדיקות ההכרעה](<C:/Users/יעקב/Downloads/pro/netunim/tests/runtime_morning_resolution.py>); [בדיקת replay לאחר כשל ניקוי](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-approved-replay.log>); [בדיקות startup ומרוץ האישור](<C:/Users/יעקב/Downloads/pro/netunim/.work/morning-startup-resolution.log>).

**שער הפריסה — כל suite בנפרד**

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

שלוש חבילות PostgreSQL — `supabase_candidate.py`, `supabase_retention.py`, `morning_ledger.py` — הורצו במסגרת השער המלא וגם בנפרד, וכולן PASS, עם cluster מקומי זמני ופורט אקראי, לא מול production. לוגי ההרצות הנפרדות נמצאים ב-`.work/morning-snapshot-candidate-independent.log`, `.work/morning-snapshot-retention-independent.log`, `.work/morning-snapshot-ledger-independent.log`. בדיקות schema, retention, הרשאות, migration ו-account-wide fingerprint guard עברו. `pg_cron` ב-Windows נבדק דרך קטלוג התזמון המדומה הקיים, ללא worker תזמון אמיתי.

**בדיקות הבטיחות הקודמות שנשמרו**

| תרחיש | תוצאה |
|---|---|
| 320 מלא סוגר תשלום וחשבונית פעם אחת | PASS |
| 400 מעדכן תשלום בלבד; 305 חשבונית בלבד | PASS |
| חלקי בכמה פעימות ומעל יתרה, בלי יתרה שלילית | PASS |
| opt-out עצמאי לתשלום/חשבונית שכבר נרשמו ידנית | PASS |
| כפילות create/reconciliation, ללא save/render מיותר ליישום עמיד שכבר הושלם | PASS |
| Reset ידני ואז replay אינו מחיה אירוע שבוטל | PASS |
| קריסה אחרי reserve ולפני POST: ביטול reservation בלי מסמך | PASS |
| תשובת POST אבודה אינה גורמת ל-POST נוסף | PASS |
| כשל persistence משמר Recovery ו-replay שומר מחדש | PASS |
| removeItem נכשל ב-created/failed/reserved: הנעילה נשארת | PASS |
| result לא מוכר מיישום החוב: אין ניקוי Recovery | PASS |
| Secondary אינה מפיקה; Primary מפיקה; איבוד ownership באישור עוצר | PASS |
| Recovery אינו מועבר לחוב אחר | PASS |
| שינויי חוב כספיים ומחיקה יחידה/מרובה נעולים באותו דפדפן במהלך Recovery | PASS |
| הערות/supplied וחובות אחרים זמינים | PASS |
| A ו-B מוסיפים תשלומים שונים: איחוד האירועים | PASS |
| Reset ב-A ותשלום חדש ב-B: רק האירועים שה-Reset הכיר מבוטלים | PASS |
| שתי פעולות Morning שונות: איחוד לפי IDs ויתרה לא שלילית | PASS |
| שתי בקשות זהות במקביל: fingerprint guard, POST אחד | PASS |
| append-only; תוכן עסקי שונה באותו ID גורם conflict | PASS |
| timestamps בלבד אינם conflict עסקי | PASS |
| סיכומי החוב משתמשים ב-remaining payment | PASS |
| חוב שנמחק בענן לפני reconciliation: Recovery נשמר; שחזור החוב מאפשר השלמה | PASS |

**היסטוריית הממצאים והסטטוס המעודכן**

חמשת התיקונים מהבדיקה הקודמת נשמרו: נעילת עריכות כספיות מקומיות בזמן Recovery; שחרור נעילה רק אחרי ניקוי מוצלח; מניעת conflict על timestamp בלבד; מניעת save מיותר אחרי replay עמיד; ושמירת Recovery כאשר החוב חסר. לא שונו הקוד או ה-IDs כדי לבטל בדיקות קיימות.

הממצא השישי היה פתוח: שני IDs שונים — manual ב-B ו-Morning ב-A — התמזגו תקין מבחינה טכנית אך ייצגו פעמיים את אותו תשלום. ההוכחה המקורית תיעדה 30 שהפך ל-60. כעת יש בדיקת cloud refresh + snapshot לפני האירוע השני והכרעה מפורשת, והתרחיש עבר. לוג ההוכחה הישן מתעד את המצב לפני התיקון ואינו תוצאת הקוד הנוכחי.

לא נמצאו בבדיקות המעודכנות מסמך כפול, זקיפה אוטומטית כפולה בתרחיש המעבר A→B→A, אובדן תשלום/חשבונית, מחיקת Recovery לפני הסיום הבטוח או overwrite שקט במיזוג. אישור מפורש של המשתמש לזקוף „תשלום נוסף” מוסיף תשלום בכוונה. הפתרון אינו נעילה מבוזרת ואינו מבטיח למנוע רישום ידני מקביל שמתרחש במחשב אחר *אחרי* צילום הענן האחרון; זהו היקף תרחיש המעבר שביקשת.

**כשל קוד מול כשל בחוזה בדיקה**

תשתית Morning הישנה לא סיפקה ענן כלל, משום שהיישום הישן לא דרש refresh. היא הורחבה בתעבורה מבודדת ולא ב-stub שמחזיר „refresh הצליח”: קוד refresh, outbox ו-CAS של הייצור באמת רץ. בדיקות שמוסיפות חובות ישירות למודל הותאמו לשמור את נתוני התרגיל לפני סנכרון. בדיקת חוב חסר שינתה בעבר רק את המודל המקומי; כעת היא מדמה מחיקה ב-head המרוחק והחזרת החוב בענן, משום שרענון אמיתי אמור לשחזר חוב שעוד קיים בשרת. בדיקת קריסה לפני persistence עוצרת גם את הסנכרון המדומה, כדי שתהליך שמירה ברקע לא יבטל את תרחיש הכשל. שני חוזי טקסט עודכנו להרחבה המכוונת של מבנה Recovery ולנעילה המחמירה יותר בזמן רענון. בדיקות ההגנה עצמן לא הוסרו.

**בטיחות הנתונים ומגבלות האימות**

כל הנתונים נוצרו בעותקי אתר ובפרופילי דפדפן זמניים. שרת PostgreSQL מקומי בלבד, ותעבורת Morning/ענן מדומה. לא נעשה שימוש בחובות האמיתיים, בפרופיל הדפדפן האישי או במפתחות Morning; לא הופק מסמך אמיתי, לא נפרס אתר ולא בוצע SQL בשירות החי. בדיקות startup מוסיפות fault injection רק לעותק האתר הזמני. השער מאשר את הקוד והתרחישים המקומיים; אין כאן אימות חי של מפתחות Morning, זמינות השירות או תצורת production.

**הקבצים ששונו בהמשך הנוכחי**

| קובץ | שינוי |
|---|---|
| [netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/domains/customers/morning-debt-recovery.js>) | צילום כספי מינימלי, השוואה באגורות, נרמול ושמירת הכרעה/טיוטה מקומית; טיפול בטוח ברשומות ישנות. |
| [netunim-orders/site/assets/js/domains/customers/documents.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/domains/customers/documents.js>) | המתנה לרענון ענן לפני Recovery; מסך השוואה והכרעה; שמירת האישור לפני היישום; בדיקה חוזרת אם המצב השתנה; תשובת create מאוחרת לאחר ניתוק מטופלת כהתאוששות. |
| [netunim-orders/site/assets/js/domains/customers/composition.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/domains/customers/composition.js>) | הזרקת פעולת רענון הענן וחיבור פעולות ההכרעה. |
| [netunim-orders/site/assets/js/sync/document.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/sync/document.js>) | refreshForMorningRecovery: המתנה לסנכרון פעיל, סיום outbox קיים, GET מלא חדש ומאומת, רענון המודל ושמירה מקומית; cloudPoll מחזיר Promise שמייצג השלמה. |
| [netunim-orders/site/assets/js/main.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/main.js>) | חיבור רענון ניהול ההזמנות ל-Morning ורישום פעולות ההכרעה. |
| [netunim-orders/site/assets/js/ui/actions.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/assets/js/ui/actions.js>) | פעולות שינוי בחירה ואישור ההכרעה בממשק. |
| [netunim-orders/site/service-worker.js](<C:/Users/יעקב/Downloads/pro/netunim/netunim-orders/site/service-worker.js>) | עדכון מזהה המטמון באמצעות tools/sync-assets.py. |
| [tests/morning_debt_recovery.test.mjs](<C:/Users/יעקב/Downloads/pro/netunim/tests/morning_debt_recovery.test.mjs>) | בדיקות snapshot מינימלי, מטא-דאטה לא כספית, החלטה שמורה, legacy ו-replay לפי IDs בלבד. |
| [tests/morning_documents_contracts.py](<C:/Users/יעקב/Downloads/pro/netunim/tests/morning_documents_contracts.py>) | התאמת חוזי המבנה להרחבת Recovery ולנעילה שנשארת גם בזמן רענון ענן. |
| [tests/runtime_morning.py](<C:/Users/יעקב/Downloads/pro/netunim/tests/runtime_morning.py>) | שילוב בדיקות הענן וההכרעה בתוך runtime_morning.py ושער הפריסה המלא. |
| [tests/runtime_morning_audit.py](<C:/Users/יעקב/Downloads/pro/netunim/tests/runtime_morning_audit.py>) | התאמת תשתית הבדיקות הישנה לרענון הענן הנדרש, בלי להסיר בדיקות בטיחות קודמות. |
| [tests/runtime_morning_cloud.py](<C:/Users/יעקב/Downloads/pro/netunim/tests/runtime_morning_cloud.py>) | תעבורת ענן מבודדת; מנגנוני refresh, שמירה, outbox ו-CAS של הייצור נשארים פעילים. |
| [tests/runtime_morning_resolution.py](<C:/Users/יעקב/Downloads/pro/netunim/tests/runtime_morning_resolution.py>) | תרחישי A/B, המתנה לתשובת GET, startup/online/visibilitychange, הכרעה, reload, כשל שמירה, שינוי נוסף ו-idempotency. |
| [MORNING_READINESS_AUDIT.md](<C:/Users/יעקב/Downloads/pro/netunim/MORNING_READINESS_AUDIT.md>) | הדוח המעודכן. |

קובצי SQL, ה-Edge Function, סכמות, אירועים קיימים והקוד של מנגנון הזקיפה/מיזוג ledger מהתיקון הקודם לא שונו. לוגים וסקריפטים אבחוניים נמצאים ב-`.work/`. השינויים נשארו מקומיים ומוכנים לסקירה ולפריסה שלך.
