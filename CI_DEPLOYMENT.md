# בדיקות ב־GitHub ופריסה מהירה

## שימוש יומיומי

1. שומרים את השינויים, עושים commit ו־push ל־GitHub.
2. ב־Actions ממתינים להצלחת **Full verification**, כולל **Verification complete**, עבור ה־commit שרוצים לפרוס.
3. מריצים את אחד הקבצים הבאים:

| מה לפרוס | בדיקות מלאות במחשב לפני הפריסה | שימוש בבדיקות שכבר עברו ב־GitHub |
| --- | --- | --- |
| שני האתרים | `deploy_all.bat` | `deploy_all_fast.bat` |
| ניהול הזמנות | `netunim-orders\deploy_site.bat` | `netunim-orders\deploy_site_fast.bat` |
| ניהול קופה | `netunim-kupa\deploy_site.bat` | `netunim-kupa\deploy_site_fast.bat` |

כל הקבצים תומכים ב־`--preflight-only`: מבצעים את שערי הבדיקה המתאימים למסלול, ללא העלאה.
לדוגמה: `deploy_all_fast.bat --preflight-only`.

המסלול המהיר דורש Git, Python, Node/npm ו־GitHub CLI (`gh`) ב־PATH. מתחברים ל־GitHub פעם אחת באמצעות `gh auth login`.
אין צורך בתלויות הבדיקות, בדפדפן בדיקה או ב־PostgreSQL מקומי במסלול המהיר.
ההתחברות ל־Cloudflare נשארת כפי שהייתה בקובצי הפריסה הקיימים.

נבדקת ריצת **push** מוצלחת של `verify.yml` לאותו SHA בדיוק, כולל הצלחת כל קבוצות הבדיקות ובדיקת Windows.
ריצה חלקית, מדולגת, מבוטלת או שעדיין פועלת אינה אישור. כישלון חדש לאותו commit אינו מאפשר להשתמש בהצלחה ישנה.
בדיקת PR על commit מיזוג זמני אינה מאשרת commit מקומי אחר.

נדרש עץ עבודה נקי: שינויים שלא נכללו ב־commit, שינויים ב־staging וקבצים חדשים עוצרים את המסלול המהיר.
גם קבצים שה־Git מתעלם מהם בתוך `site/` נעצרים, מפני ש־Wrangler היה מעלה אותם.
תיקיות מוחרגות מחוץ לאתרים, כגון `.work/` ו־`node_modules/`, מותרות.
אם שיניתם קוד מאז ה־push, דוחפים את השינוי וממתינים לבדיקות, או משתמשים במסלול המקומי המלא.

לאחר אישור GitHub נשארים סריקה קצרה של קובצי האתר, כל שומרי הפריסה הקיימים וההתאמה לאישור הפריסה האחרון
של Supabase. בפריסה משולבת נבדקים מראש שני האתרים לפני ההעלאה הראשונה. העלאות Cloudflare עדיין נפרדות:
תקלה בשירות במהלך ההעלאה השנייה יכולה להשאיר את האתר הראשון מעודכן; אין עסקה אטומית בין שני אתרים.
אם מוגדרת גישה מפורשת ל־Supabase לצורך בדיקת מצב חי, גם הבדיקה הזו נשארת פעילה.

## מבנה השרשרת

`tests/verification_plan.py` הוא רשימת המקור היחידה. `verify.bat`, ‏`npm test` וה־matrix של GitHub משתמשים
באותה רשימה. ב־GitHub כל קבוצה מקבלת מכונה נפרדת; בתוך קבוצה בדיקות Python רצות לפי הסדר,
ובדיקות JavaScript משתמשות בשני תהליכי Node מבודדים.

| קבוצה | כיסוי |
| --- | --- |
| `contracts` | מבנה, תחביר, חוזים, הרשאות, נכסים, פריסה ותשתית ה־CI |
| `models` | נכסים משותפים, גרף המודולים, ESLint וכל קובצי `tests/*.test.mjs` |
| `database` | המיגרציות המועמדות, הרשאות, retention ויומן Morning על PostgreSQL זמני |
| `browser-ui` | טעינה, התאמה למסכים, לוח שנה ואירועי ממשק |
| `browser-morning` | תהליכי Morning, ביקורת בטיחות ויישוב תוצאות |
| `browser-lifecycle` | אבטחה בדפדפן, PWA, ביצועים ושלמות נתונים |
| `browser-sync` | תהליכים עסקיים, שחזור, לשוניות, שני מחשבים ובדיקות כספיות |
| `browser-database` | סנכרון דפדפן מול HTTP ו־PostgreSQL מקומיים, אובדן תשובה וקונפליקטים |

בנוסף רצה **Windows deployment contracts**, שמפעילה את קובצי BAT דרך `cmd.exe`, בתיקיות זמניות ועם תחליפים
להעלאות. היא בודקת בחירת אתר, סדר שערים, כשלים, קודי יציאה ונתיבים עם רווחים. היא אינה פורסת אתרים.
**Verification complete** מצליחה רק אם ה־plan, כל שמונה הקבוצות ובדיקת Windows הצליחו.

בדיקות JavaScript שבעבר הופעלו מתוך בדיקות Python רוכזו ב־`node_models.py`, כדי להריץ כל קובץ פעם אחת
ולהכליל אוטומטית קבצים חדשים. כך נכללות גם בדיקות התזכורות, מרוץ הגלילה ובקרי לוח השנה שלא נכללו קודם
בשרשרת. בדיקות Python חדשות יש להוסיף לקבוצה המתאימה ברשימת המקור.

כלים ליצירת ביקורת היסטורית, שכתוב מלאי שדרוגים ובדיקות המחייבות התקנת Camoufox ייעודית או חיבור בנק חי
אינם חלק מה־CI. בדיקות הבנק המבודדות כן נכללות. ה־CI אינו מקבל סודות Production, אינו מריץ מיגרציות
ב־Production ואינו מפרסם אתרים. מודל `pg_cron` הזמני בודק חוזים ו־SQL, ולא את תהליך התזמון החי.

## מהירות, אבחון ואכיפה

ה־workflow מופעל בכל push, כולל tags, בכל PR, בתור מיזוג ובהפעלה ידנית, ללא סינון לפי קבצים או ענפים.
לא מבטלים ריצה קודמת כשמגיע push חדש, ו־`fail-fast: false` מאפשר לקבל את כל הכשלים גם אם קבוצה אחת נכשלה.
GitHub בודק את קצה כל push; אם push אחד כולל כמה commits, אין ריצה נפרדת לכל commit ביניים.
הודעות מסוג `[skip ci]` יכולות למנוע הפעלה לפי מנגנון GitHub; אין להשתמש בהן לגרסה המיועדת לפריסה מהירה.

הזמן הכולל קרוב לזמן הקבוצה האיטית ביותר בתוספת הכנת המכונות ותורים. המקביליות מקצרת זמן המתנה, אך אינה
מפחיתה בהכרח את סך דקות החישוב. מגבלות המקביליות והחיוב של חשבון GitHub עדיין חלות.
לא נשמר cache של npm או pip בין ריצות האימות. `npm ci` משתמש ב־cache זמני בתוך ה־runner הנוכחי בלבד, ו־pip מותקן עם `--no-cache-dir`; כך ריצה חדשה אינה יכולה לרשת חבילת dependency מריצה קודמת. ממילא אין cache של תוצאות בדיקות או של `node_modules`.
מכונות Ubuntu 24.04 מספקות Chrome; בקבוצות המסד מוגדר במפורש מאגר PGDG הרשמי עם אימות חתימה ומותקן PostgreSQL 18.
PostgreSQL 16 המותקן מראש אינו מתאים: המיגרציות דורשות את הרשאת MAINTAIN שנוספה ב־17.
Node 24 ו־Python 3.14 מוגדרים במפורש, תלויות Python של CI מקובעות, ופעולות GitHub מקובעות ל־SHA.
Dependabot מציע עדכונים לפעולות בקבוצה חודשית.

לכל קבוצה יש artifact עם לוג לכל suite, ‏`results.json`, ‏`junit.xml` וטבלת זמנים, שנשמרים 14 ימים גם בכישלון.
כשל בהתקנת הסביבה עשוי להתרחש לפני שנוצרו דוחות; במקרה כזה בודקים את לוג ה־job.
שני האתרים נבדקים בכל push גם כאשר רק אתר אחד השתנה, מפני שיש להם קוד וחוזי נתונים משותפים.

אבחון מקומי של קבוצה:

```text
python tests/run_all.py --group contracts --keep-going --report-dir .work/ci/contracts
python tests/run_all.py --group models --keep-going --report-dir .work/ci/models
python tests/run_all.py --ci-matrix
```

קבוצה בודדת אינה אישור לפריסה. `python tests/run_all.py` ו־`verify.bat` ממשיכים להריץ את כל השרשרת.
ב־Linux בדיקות BAT מדולגות; ב־GitHub הן מכוסות ב־job ה־Windows הנפרד והמחייב.

בדיקות Actions מתבצעות **לאחר** push. כדי לחסום מיזוג ל־`main` עד הצלחה, אפשר להגדיר ב־GitHub Rulesets
או Branch protection את **Verification complete** כ־required status check. קובץ workflow אינו יוצר הגנת ענף.
הגדרות הגנת הענפים לא שונו כחלק מהוספת השרשרת.

## תיעוד רשמי

- [מטריצות והרצה מקבילית](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations)
- [בדיקות חובה, דילוגים ותלות בבדיקות אחרות](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)
- [התוכנות במכונות Ubuntu 24.04](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md)
- [התקנת PostgreSQL ב־Ubuntu](https://www.postgresql.org/download/linux/ubuntu/)
- [התקנה ו־cache של Node](https://github.com/actions/setup-node)
- [התקנה ו־cache של Python](https://github.com/actions/setup-python)
- [דילוג באמצעות הודעת commit](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)
- [העלאת אתר באמצעות Cloudflare Wrangler](https://developers.cloudflare.com/pages/get-started/direct-upload/)
