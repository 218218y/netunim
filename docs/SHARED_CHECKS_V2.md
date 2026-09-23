# Shared Checks Storage V2

עדכון: 23 בספטמבר 2026. [מצב המעבר והחסמים להפעלת V2-only](STORAGE_V2_CUTOVER_STATUS.md) הוא מקור האמת לשחרור גרסה.

Shared Checks V2 הוא journal נפרד לפי חשבון, בבעלות יחידה על `checks` ו־`bankEvents`. בזמן Primary, שתי האפליקציות שומרות עריכת צ׳ק רק בו; Main V2 אינו מקבל פעולת צ׳ק רגילה. בהפעלה משחזרים את Main ואת Shared ומרכיבים מהם את המודל המוצג. העתק `checks` שנותר ב־Main checkpoint ישן אינו סמכותי ויוסר רק בגרסת cleanup.

ל־Shared יש checkpoint, cloud base/revision, cursor, flight ו־control עצמאיים. ה־RPC הקיים מקבל snapshot ומחיקות מפורשות מתוך flight בלתי משתנה. Retry אחרי lost ACK חוזר עם אותו `operationId`; conflict מאומת עובר merge ו־rebase אטומי. אירועי בנק שהשרת מחזיר נכתבים ל־checkpoint באותה transaction של ACK/rebase.

פעולות restore וייבוא מלא שנוגעות ל־Main ול־Shared עוברות דרך `storage-v2-boundary.js`. כל צד רושם אותו boundary ID, ו־restart ממשיך את השלבים החסרים בלי להפעיל צד שכבר הושלם. ייבוא קובץ מקומי משתמש ב־`replace-local-with-pending`: בסיס הענן וה־revision הקיימים נשמרים, נוצר pending V2 לכל domain, וה־`bankEvents` החיים נשמרים. ייבוא איננו ACK מהענן.

Primary פעיל באפליקציה רק עבור בעלים עם סמן cutover מאומת. מצב Shadow אופציונלי משמש להשוואת replay בתקופת המעבר; הוא אינו כותב cursor או flight ואינו מקור סמכות. קוד Primary והמנוע נבדקו, אך ברירת המחדל של המוצר עדיין אינה V2-only. אין למחוק V1 עד שחיבור first-cloud, מעבר חשבונות, cutover מתוזמר ובדיקות שני המחשבים יושלמו.
