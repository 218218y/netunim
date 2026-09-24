# Shared Checks Storage V2

ב־owner המקומי (`local`) ה־journal נולד, משחזר ושומר צ׳קים גם ללא cloud base. `localReady` מתאר סמכות אחסון מקומית; `cloudReady` מחייב cursor אמיתי. סנכרון ללא cursor נכשל במפורש, ללא RPC וללא retry control. ייבוא מקומי טהור מחליף את Main ואת Shared דרך boundary עמיד ואינו מייצר pending ענן. התקנה חדשה מפעילה Local V2 ו־marker עמיד כבר ב־startup.

עדכון: 24 בספטמבר 2026. [המצב התפעולי לאחר cutover](STORAGE_V2_POST_CUTOVER.md) הוא מקור האמת לשחרור גרסה.

Shared Checks V2 הוא journal נפרד לפי חשבון, בבעלות יחידה על `checks` ו־`bankEvents`. בזמן Primary, שתי האפליקציות שומרות עריכת צ׳ק רק בו; Main V2 אינו מקבל פעולת צ׳ק רגילה. בהפעלה משחזרים את Main ואת Shared ומרכיבים מהם את המודל המוצג. העתק `checks` שנותר ב־Main checkpoint ישן אינו סמכותי ויוסר רק בגרסת cleanup.

ל־Shared יש checkpoint, cloud base/revision, cursor, flight ו־control עצמאיים. ה־RPC הקיים מקבל snapshot ומחיקות מפורשות מתוך flight בלתי משתנה. Retry אחרי lost ACK חוזר עם אותו `operationId`; conflict מאומת עובר merge ו־rebase אטומי. אירועי בנק שהשרת מחזיר נכתבים ל־checkpoint באותה transaction של ACK/rebase.

פעולות restore וייבוא מלא שנוגעות ל־Main ול־Shared עוברות דרך `storage-v2-boundary.js`. כל צד רושם אותו boundary ID, ו־restart ממשיך את השלבים החסרים בלי להפעיל צד שכבר הושלם. ייבוא קובץ מקומי משתמש ב־`replace-local-with-pending`: בסיס הענן וה־revision הקיימים נשמרים, נוצר pending V2 לכל domain, וה־`bankEvents` החיים נשמרים. ייבוא איננו ACK מהענן.

Primary פעיל עבור בעלים עם סמן cutover מאומת או Local Engine marker. בזמן הכנת מעבר עמיד פועל מצב `preparing` סגור לעריכות רגילות. מצב Shadow הישן אינו מקור סמכות. מסלולי first-cloud, העלאה ראשונה מ־`local` והחלפת חשבון משתמשים ב־V2 ובשחזור מנותק של היעד לפני החלפת owner. שני המחשבים הראשיים כבר עברו; קוראי V1 נשארים זמנית לצורך התאוששות וניקוי מדורג.
