# Morning / חשבונית ירוקה — הגדרה ופריסה

החיבור משתמש ב-**Edge Function אחת בלבד** בשם `morning-documents`.

`MORNING_CLIENT_ID`, `MORNING_CLIENT_SECRET` ו-`MORNING_ENV` **אינם שלוש פונקציות**. אלה משתני סביבה שהפונקציה היחידה קוראת בזמן ריצה:

| משתנה | משמעות | חובה |
|---|---|---|
| `MORNING_CLIENT_ID` | מזהה ה-API Key / OAuth Client ID של Morning | כן |
| `MORNING_CLIENT_SECRET` | הסיסמה הסודית / OAuth Client Secret של Morning | כן |
| `MORNING_ENV` | סביבת Morning: `production` או `sandbox` | לא; ברירת המחדל היא `production` |

ה-PWA לעולם אינו מקבל את ה-Client Secret. גם את ה-Client ID אין צורך לשים בקבצי האתר. שניהם נשמרים בצד השרת ב-Supabase.

> חשוב: ל-Sandbox ול-Production יש credentials נפרדים. שינוי `MORNING_ENV` ל-`sandbox` אינו הופך מפתחות Production למפתחות Sandbox ולהפך.

## 1. עדכון מסד הנתונים

בפרויקט Production שכבר מנוהל על-ידי שרשרת המיגרציות של המאגר, **אין לסמן ידנית שהמיגרציות הוחלו ואין לעדכן ידנית את `production-deployment-receipt.json`**. ארבע המיגרציות הבאות חייבות להיכנס ל-Production דרך מסלול migration שמעדכן גם את `supabase_migrations.schema_migrations`, לפי הסדר:

1. `supabase/migrations/20260908190000_morning_verified_creation.sql`
2. `supabase/migrations/20260908194500_morning_global_idempotency.sql`
3. `supabase/migrations/20260908203000_morning_ledger_owner_retention.sql`
4. `supabase/migrations/20260908204500_morning_preissue_reservation.sql`

Supabase CLI העדכני משתמש ב-`supabase migration list` כדי להשוות local/remote וב-`supabase db push --dry-run` לפני `supabase db push` כדי להציג ולהחיל רק migrations שטרם נרשמו. השתמש במסלול הזה רק מתוך סביבת CLI שמחוברת **לפרויקט הנכון ושבה תיקיית `supabase/migrations` הזו היא השרשרת הפעילה**. אם סביבת ה-CLI שלך משתמשת בתיקיית עבודה אחרת, אל תעתיק קבצים או תריץ `migration repair` כדי “ליישר” היסטוריה בלי review; השתמש במסלול הפריסה הקיים של המאגר.

לאחר ההחלה יש להריץ live postflight וליצור source-audit + Production receipt חדשים. עד אז `verify.bat` רשאי לאמת שה-release המקומי reviewed, אבל `deploy_site_core.bat` ימשיך לעצור לפני העלאת האתר — בכוונה — כי ה-Production receipt עדיין מתאר את המצב הישן.

להתקנה חדשה/מבודדת שאינה משתמשת בהיסטוריית ה-Production הקיימת אפשר להשתמש ב-`netunim-orders/supabase/morning_documents.sql` כמקור סכמה. אין להשתמש בו כדי לעקוף את שרשרת המיגרציות של Production.

המיגרציות **משמרות את הטבלה והפעולות הקיימות**: הראשונה מוסיפה `verified_at`, ממירה הצלחות ישנות ל־`created_unverified` עד לקריאת אימות ומקשיחה שיוך `document_id`; השנייה מרחיבה את נעילת ניסיונות ההפקה הלא־פתורים ואת ייחודיות `document_id` לכל משתמשי האפליקציה שעובדים מול אותו חשבון Morning בסביבה המוגדרת; השלישית מסירה רק את ה־FK המדורג מ־`owner_id`, כדי שמחיקת משתמש Supabase לא תמחק ראיית idempotency או ניסיון הפקה לא־פתור; הרביעית מפרידה בין `reserved` — רישום DB שבו בוודאות טרם התחיל POST ל־Morning — לבין `pending`, שבו בקשת ההפקה כבר נכנסה לחלון החיצוני הלא־ודאי, ושומרת `issuance_started_at` לצורך reconciliation מדויק. המיגרציות אינן מוחקות מסמכי Morning או נתוני חובות. אין להריץ DROP ידני.

הטבלה `morning_document_operations` היא ledger קטן בלבד לצורכי idempotency, מניעת כפילויות וקישור למסמך. PDF ותוכן המסמך המלא נשארים ב-Morning.

## 2. התחלה בטוחה ב-Sandbox של Morning

לניסוי **לא משתמשים במפתחות Production**. ל-Morning יש Sandbox נפרד עם נתונים ומפתחות נפרדים.

1. צור/פתח חשבון Morning Sandbox.
2. בתוך חשבון ה-Sandbox צור API Key וקבל `Client ID` ו-`Client Secret` של ה-Sandbox.
3. שמור אותם רק ב-Supabase Secrets.
4. הגדר `MORNING_ENV=sandbox`.

מפתח API שיצרת בחשבון Morning הרגיל הוא מפתח Production ואינו אמור לעבוד ב-Sandbox.

## 3. הגדרת Secrets ב-Supabase

יש **Edge Function אחת** בשם `morning-documents`. שלושת הערכים הבאים הם משתני סביבה שלה, לא שלוש פונקציות:

```text
MORNING_CLIENT_ID=<מזהה ה-API Key של Morning Sandbox>
MORNING_CLIENT_SECRET=<הסיסמה הסודית של Morning Sandbox>
MORNING_ENV=sandbox
```

### דרך ה-Dashboard

בפרויקט הנכון פתח:

**Edge Functions > Secrets**

והוסף את שלושת הערכים לעיל. אפשר להדביק כמה Secrets יחד ולשמור. אין לשים את ה-Client Secret בקוד הפונקציה, ב-SQL או בקבצי האתר.

### דרך Supabase CLI

Project Ref של ניהול הזמנות/קופה הוא:

```text
bupoidcurcxuypfrjqio
```

הוא מאומת גם ב-`site/supabase/config.js` וגם בקבצי ה-release של הפרויקט. אם `supabase projects list` אינו מציג אותו, ה-CLI מחובר לחשבון Supabase אחר. **אל תבחר פרויקט אחר רק כדי להמשיך.**

ב-Windows PowerShell אפשר לעבוד מתיקיית:

```text
C:\Users\יעקב\Downloads\pro\netunim\netunim-orders
```

ודא שבתוכה קיימים:

```text
supabase\config.toml
supabase\functions\morning-documents\index.ts
```

לאחר מכן:

```powershell
supabase logout
supabase login
supabase projects list
```

התחבר לחשבון Supabase שמכיל את הפרויקט `bupoidcurcxuypfrjqio`. לאחר שהוא מופיע ברשימה:

```powershell
supabase link --project-ref bupoidcurcxuypfrjqio
```

אם `supabase login` ממשיך להחזיר אותך לחשבון הלא נכון בגלל שיש לך שני חשבונות, פתח בחשבון הנכון את **Account > Access Tokens**, צור Personal Access Token זמני/ייעודי והשתמש בו ב-`supabase login` כאשר ה-CLI מבקש token. לאחר מכן הרץ שוב `supabase projects list`. אל תעתיק את ה-token לקוד, ל-SQL או לקובץ `.env` שנכנס לפרויקט.

אין צורך לבחור אינטראקטיבית את `paqzrxrvowwndevqptdk`; זה אינו הפרויקט של ניהול הזמנות/קופה.

הגדרת Secrets של Sandbox:

```powershell
supabase secrets set MORNING_CLIENT_ID="SANDBOX_CLIENT_ID" MORNING_CLIENT_SECRET="SANDBOX_CLIENT_SECRET" MORNING_ENV="sandbox" --project-ref bupoidcurcxuypfrjqio
```

בדיקה שהשמות נשמרו:

```powershell
supabase secrets list --project-ref bupoidcurcxuypfrjqio
```

Supabase אינו מציג את ערכי הסודות עצמם בחזרה.

## 4. פריסת Edge Function דרך ה-Dashboard — Via Editor

זו **פונקציה אחת חדשה**.

1. פתח את הפרויקט שה-URL שלו מכיל `bupoidcurcxuypfrjqio`.
2. בתפריט השמאלי פתח **Edge Functions**.
3. לחץ **Deploy a new function**.
4. בחר **Via Editor**.
5. בשדה Function name כתוב בדיוק:

```text
morning-documents
```

6. בעורך מחק את קוד הדוגמה והדבק **את כל תוכן הקובץ**:

```text
netunim-orders/supabase/functions/morning-documents/index.ts
```

הקובץ הוא מקור הקוד הקנוני. אין להעתיק רק חלק ממנו ואין להכניס אליו את מפתחות Morning.

7. כבה את **JWT verification של שער Supabase** עבור הפונקציה הזאת. הסיבה היא בקשות CORS `OPTIONS` מהדפדפן: הן חייבות להגיע ל-Function כדי לקבל כותרות CORS תקינות.

   זה **לא הופך את פעולות Morning לציבוריות**: הקוד עצמו מפעיל `requireUser(req)` ומאמת את ה-JWT מול `auth.getUser()` לפני קריאת גוף הבקשה ולפני כל פעולה ב-Morning. בקשת `POST` ללא משתמש Supabase תקף מוחזרת כ-401.
8. לחץ **Deploy function**.
9. לאחר הפריסה פתח את הפונקציה ובדוק ב-Logs שאין שגיאת import/configuration.

### פריסה דרך CLI במקום ה-Editor

מתוך `netunim-orders` לאחר `supabase link`:

```powershell
supabase functions deploy morning-documents --no-verify-jwt --project-ref bupoidcurcxuypfrjqio
```

הקובץ `supabase/config.toml` מגדיר במפורש:

```toml
[functions.morning-documents]
verify_jwt = false
```

## 5. בדיקת Sandbox לפני מסמך רשמי

1. ודא שב-Secrets מוגדר `MORNING_ENV=sandbox` וששני המפתחות הם של Sandbox.
2. התחבר לאתר ניהול הזמנות כרגיל דרך Supabase Auth.
3. פתח `לקוחות > חובות` ובחר חוב בדיקה.
4. פתח Morning וודא שהכותרת מציגה סביבת Sandbox.
5. התחל ב-**תצוגה מקדימה**. Preview אינו מפיק מסמך רשמי.
6. רק לאחר שה-PDF נראה נכון, נסה הפקת מסמך ב-Sandbox.
7. ודא שהמסמך מופיע בחשבון Morning Sandbox ולא בחשבון Production.

רק לאחר שהבדיקה הושלמה מחליפים את שני ה-Secrets לזוג Production ומגדירים:

```text
MORNING_ENV=production
```

## 6. מספרי הקצאה — חשבוניות ישראל

האתר **לא פונה ישירות לרשות המסים** לקבלת מספר הקצאה. Morning מטפלת בבקשת ההקצאה כחלק ממערכת החשבוניות שלה כאשר:

- קיימת ב-Morning הרשאה פעילה לחיבור לרשות המסים.
- מדובר בסוג מסמך מתאים, כגון חשבונית מס / חשבונית מס-קבלה.
- מולאו פרטי הלקוח הנדרשים, ובפרט מספר העוסק / ח.פ. כאשר מדובר בלקוח עסקי.
- המסמך עומד בתנאי מודל חשבוניות ישראל.

נכון ל-1 ביוני 2026, התקרה הרלוונטית לפי רשות המסים היא עסקה שסכומה **מעל 5,000 ₪ לפני מע"מ**, בכפוף לשאר התנאים שבדין.

לאחר הפקה, ה-Edge Function קוראת שוב את המסמך הרשמי מ-Morning ושומרת רק את `allocationNumber` אם התקבל. במסך המסמכים ובאישור ההפקה יוצג מספר ההקצאה לצד המסמך. אם המספר נוסף ב-Morning מאוחר יותר או התבקש שם ידנית, הכפתור **„בדוק שוב”** מרענן אותו מהמסמך הרשמי.

אם חשבונית שדורשת הקצאה מוצגת ללא מספר:

1. בדוק שב-Morning החיבור לרשות המסים פעיל.
2. בדוק שמספר העוסק / ח.פ. של הלקוח הוזן במסמך.
3. אם Morning לא קיבלה את המספר אוטומטית, ניתן לבקש אותו מתוך Morning ולאחר מכן ללחוץ באתר „בדוק שוב”.

אין להוסיף לקוד API Key נוסף של רשות המסים לצורך הזרימה הזו.

## 7. בדיקה נוספת לפני Production

אם יש לך credentials של Morning Sandbox, הגדר את **מפתחות ה-Sandbox** ואת:

```text
MORNING_ENV=sandbox
```

לאחר מכן:

1. פתח `לקוחות > חובות`.
2. לחץ על אייקון המסמך בשורת החוב.
3. ודא שבשורת החיבור מופיע `Morning Sandbox`.
4. בחר סוג מסמך וודא שכל הפרטים נכונים.
5. לחץ **„תצוגה מקדימה”**. Preview אינו מפיק מסמך רשמי.
6. רק לאחר בדיקה לחץ **„הפק מסמך רשמי”** ואשר.

לפני מעבר ל-Production החלף לזוג credentials של Production והגדר `MORNING_ENV=production`.

## 8. מה נשמר באתר ומה נשאר ב-Morning

ב־ledger נשמרים רק מזהה פעולה, UUID של המשתמש שיזם אותה, סביבה, fingerprint, מצב, פרטי זיהוי מינימליים, מזהה/מספר מסמך, מספר הקצאה ונתוני reconciliation. אין debt_id ואין URL. ה־UUID נשמר כערך היסטורי ללא `ON DELETE CASCADE`, כך שמחיקת משתמש מהאפליקציה לא יכולה למחוק בטעות הגנת idempotency של מסמך שכבר נשלח או שנמצא במצב לא־ודאי. פתיחת הפקה מתוך חוב מעתיקה prefill בלבד; paid, invoiceIssued, closedAt וסכומים אינם משתנים.

לא נשמרים אצלך PDF-ים של החשבוניות ולא ארכיון מלא של Morning. המסמך הרשמי ומקור האמת נשארים ב-Morning.

## 9. התנהגות במקרי תקלה

- אין retry אוטומטי ל-POST שמפיק מסמך.
- כל ניסיון מקבל `operation_id` ונרשם תחילה כ־`reserved`. רק בקשה אחת יכולה לבצע מעבר אטומי `reserved → pending`; **רק אחרי המעבר הזה** מותר לקוד לקרוא ל־`POST /documents`. כך retry מקביל של אותו operation אינו יכול לשלוח פעמיים.
- אם התהליך נעצר אחרי הרישום ולפני ה־claim, `reserved` מוכיח שלא נשלח מסמך וניתן לחדש את אותה פעולה בבטחה. reservation ישן שלא נתפס להפקה משתחרר בצורה מותנית בלבד, בלי לגעת ב־`pending`.
- ניתוק, HTTP 408 או כל 5xx לאחר שליחת בקשת ההפקה מסומנים `needs_reconciliation`; אין retry אוטומטי. fingerprint זהה נחסם ברמת סביבת Morning כולה, גם אם הגיע ממשתמש Supabase אחר.
- אם POST חזר עם `document_id` אבל קריאת האימות החוזרת נכשלה או אינה תואמת לפרטי הבקשה, הפעולה עוברת ל־`created_unverified`: **לא מוצגת הצלחה ולא נשלח POST נוסף**. `בדוק מצב הפקה` מבצע GET ישיר לאותו מזהה.
- `created` פירושו שהמסמך נקרא שוב מ־Morning, סוג/סכום/תאריך/לקוח/תיאור תאמו לבקשה ונשמר `verified_at`. רק מצב זה מוחזר כהצלחה רגילה. replay של **אותו `operation_id`** מחזיר את אותה הצלחה ואינו שולח POST נוסף. fingerprint של תוכן אינו נשאר נעול לאחר הצלחה, כדי לא לחסום בטעות שני מסמכים עסקיים לגיטימיים עם פרטים זהים.
- reconciliation של timeout ללא מזהה מחפש מועמדים ואז קורא את המסמך המלא מ-Morning לפני שיוך.
- שמירת `document_id` נעשית לפני האימות ככל שה־DB זמין; כשל מקומי לאחר אימות Morning מסומן `local_link_pending` וחוסם ניסיון נוסף במקום להפוך את ההפקה לבטוחה ל-retry.
- `MORNING_ENV` מקבל רק `production` או `sandbox`; ערך שגוי חוסם הפקה במקום ליפול בשקט ל-Production.
- קריאות בטוחות כמו GET/search יכולות לבצע לכל היותר שני ניסיונות נוספים על HTTP 429, תוך כיבוד `Retry-After` והשהיה מוגבלת. `POST /documents` שמפיק מסמך **אינו** מקבל retry כזה. גם על 401 של POST ההפקה אין resend אוטומטי: ה־token רק נמחק מה־cache, והניסיון המפורש הבא מקבל OAuth token חדש.


## חיפוש וצפייה ישירות ב־Morning

כפתור **הצג מסמכים** צמוד מימין ל־**הפק מסמך** ומחפש live באמצעות `search_documents` באותה Edge Function. ברירת המחדל היא היום פחות 90 יום ועד היום, 25 מסמכים לעמוד, מהחדש לישן. הדפדפן עובד עם page=0, והשרת ממיר לעמודי Morning שמתחילים ב־1. סוג, סטטוס, שם לקוח ותאריכים נבדקים בשרת; אין העברת payload חופשי ל־Morning. כפתור רענן עוקף cache בזיכרון של 90 שניות.

לאחר הפקה שאומתה, ה־UI טוען אוטומטית את ה־PDF הרשמי לתצוגה המקדימה. `get_document` נקרא רק בפתיחת פרטים. ״צפה״ קורא `document_pdf`: ה־Edge Function מבקשת מ־Morning קישור PDF טרי, מורידה את הקובץ בצד השרת, מגבילה אותו ל־20MB, מאמתת חתימת `%PDF-`, ומחזירה אותו עם `no-store`; הדפדפן מציג אותו בתוך האתר כ־Blob זמני ב־iframe מקומי. ״הורד״ בלבד קורא `document_links` ומקבל קישור PDF טרי. אין טבלת מסמכים מקומית, אין סנכרון רקע ואין שמירת PDF או signed URL. ה־CSP נשאר סגור למסגרות מרוחקות ומתיר רק `blob:` מקומי.

בקבלה ניתן לבחור חשבונית פתוחה דרך חיפוש Morning. השרת מאמת GET בחשבון Morning הנוכחי ואת סוג ומצב החשבונית; גם מסמך שנוצר ידנית יכול להיבחר.

## בטיחות מעבר ושחזור

ב־08.09.2026 נבדקו 0 פעולות לפני המעבר. לאחר ה־migration: 41 חובות לפני ואחרי וחתימת customerDebts זהה: `47487aeba6146049bbc46e1f44aa6574`. נבדקה גם התאמת קטלוג SQL; רק אובייקטי Morning השתנו.

הגיבוי מוגן ב־RLS ובהרשאות ונשאר עד השלמת SQL, Edge, browser, create/search Sandbox וכל verify.bat. אין למחוק אותו רק מפני שה־migration הצליחה. קובץ `supabase/morning_rollback.sql` משחזר את המבנה הקודם רק אם לא נוצרו פעולות חדשות חשובות; אחרת הוא עוצר ודורש שחזור משמר. הוא אינו נוגע בטבלאות עסקיות.

timeout אינו מפעיל POST נוסף. גם חיפוש ללא תוצאות אינו משחרר פעולה לא ודאית אוטומטית. reconciliation מאמת סוג, סכום, תאריך, לקוח, תיאור וחלון יצירה, ואינו מקבל מסמך שכבר זוהה עבור פעולה אחרת. בנוסף קיימים unique indexes ברמת סביבת Morning: fingerprint ייחודי כל עוד הפעולה `reserved` / `pending` / `created_unverified` / `needs_reconciliation`, ו־`document_id` ייחודי תמיד. כך מירוץ או תקלה לא יכולים לשגר בקשה זהה שנייה, בלי להגדיר בטעות את תוכן המסמך עצמו כייחודי לנצח.

נבדק מול **Morning API Documentation 2.0.0** העדכני ב־08.09.2026: האימות הוא OAuth 2.0 `client_credentials`, ה־token מוחזר כ־`accessToken`, תקף שעה ומשויך לעסק של מפתחות ה־API; Sandbox ו־Production משתמשים במפתחות וב־endpoints נפרדים. הקוד משתמש בזרימה זו ולא ב־`/v1/account/token` הישן. בדיקת הזמינות משתמשת ב־`GET /documents/types?lang=he` של משאב המסמכים הנוכחי, כך שה־health-check בודק ישירות את שכבת המסמכים שבה האינטגרציה משתמשת ואינו תלוי ב־business-profile endpoint.

הערת תאימות חשבונאית: `vatType: 0` ברמת המסמך נשאר `DocumentVatType.DEFAULT`, ואילו `income[].vatType: 1` נשאר `IncomeVatType.INCLUDED`. המיפוי הזה מופיע במפורש גם במודל של לקוח `green-invoice` 2.0.0 שעבר ל־OAuth החדש, והוא מתאים לכך שהממשק אצלנו מקבל סכום כולל מע״מ. לא הוכנס שינוי חשבונאי מיותר בערכים האלה; לפני Production עדיין מומלץ לבצע Preview + מסמך Sandbox ולבדוק את הסכום והמע״מ במסמך הרשמי.

שלב ב׳ של ה־runtime probe יבוצע רק לאחר השלמת קבלת שלב א׳. התאמת מסמכים למצב הכספי של חובות היא שלב עתידי נפרד ואינה נכללת בשדרוג הנוכחי.
