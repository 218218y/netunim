NETUNIM Document Bridge v3 - חיפוש מקומי עם Everything 1.5
=========================================================

מה תוקן ב-v3
------------
1. אין צורך לפתוח את חלון Everything ידנית.
   ה-Bridge מאתר את Everything.exe ומפעיל אותו עם האפשרות הרשמית:
     Everything.exe -startup
   זה מפעיל את Everything ברקע בלי לפתוח חלון חיפוש.

2. ה-Bridge עצמו עולה עם Windows דרך Startup של המשתמש.
   בכל הפעלה הוא מוודא ש-Everything זמין ברקע; וגם לפני כל חיפוש הוא יודע
   להפעיל את Everything מחדש אם הוא נסגר.

3. חיפוש אינו מוגבל עוד ל-PDF.
   - "תוכן קבצים" משתמש ב-content: של Everything לכל סוג קובץ ש-Everything
     מסוגל לקרוא/לחפש בו.
   - "שם קובץ" משתמש באינדקס השמות הרגיל של Everything לכל סוגי הקבצים.

4. Content Indexing אינו תנאי להתקנה.
   אם Everything מציג "Files with indexed content: 0", חיפוש content: עדיין
   יכול לעבוד על-ידי קריאת הקבצים בזמן החיפוש. הוא פשוט עלול להיות איטי יותר.
   Content Indexing מומלץ לביצועים, אבל אינו סיבה לעצור את ההתקנה.

למה לא מתקינים את ה-Bridge כ-Windows Service
--------------------------------------------
במחשב הזה קיימים גם כוננים ממופים כגון Y:\. כונן ממופה שייך למשתמש המחובר
ולא בהכרח נראה מתוך Session של Windows Service. לכן הארכיטקטורה הנכונה היא:
- Everything Service יכול להישאר מופעל לצורך אינדוקס NTFS.
- Everything.exe רץ כתהליך משתמש ברקע עם -startup, בלי חלון חיפוש.
- Document Bridge רץ כתהליך משתמש מוסתר ומדבר עם האתר ב-127.0.0.1:8766.
כך גם כונני רשת ממופים נשארים זמינים לחיפוש.

התקנה
-----
1. Everything 1.5 צריך להיות מותקן. הוא לא חייב להיות פתוח.
2. הפעל install_document_bridge.bat.
3. המתקין מוודא ש-ES קיים ואז מאתר את Everything.exe ומפעיל אותו ברקע.
4. נפתח חלון Windows רגיל לבחירת תיקיות החיפוש.
5. המתקין בודק לכל תיקייה:
   - Folder accessible
   - Files visible in Everything
   - Files with indexed content
   - ES JSON result parsing
6. אפס קבצים עם Content מאונדקס הוא WARNING בלבד, לא ERROR.
7. בסיום נפתח אוטומטית:
   %LOCALAPPDATA%\NetunimDocumentBridge\INSTALLATION-LOG.txt
   והמפתח להדבקה באתר נמצא בתחילת הקובץ.

איפה Everything.exe נמצא
------------------------
ה-Bridge מחפש בסדר בטוח ומוגבל:
- path שכבר נשמר ב-config של ה-Bridge;
- HKEY_LOCAL_MACHINE/HKEY_CURRENT_USER תחת voidtools\Everything;
- מיקומי Program Files המקובלים;
- LocalAppData המקובל;
- PATH של Windows.
אם Everything הותקן בדרך רגילה, אין צורך להגדיר נתיב ידנית.

באתר
-----
Ctrl+K -> קבצים במחשב.

אפשר לבחור:
- תוכן קבצים: content: דרך Everything. אם יש Content Indexing הוא מהיר מאוד;
  אחרת Everything יכול לקרוא תוכן בזמן החיפוש ולכן חיפוש גדול עשוי לקחת זמן.
- שם קובץ: חיפוש מהיר באינדקס השמות של Everything.

האינדקס נשאר מקומי בכל מחשב. אם יש 2-3 מחשבים, מתקינים את ה-Bridge בכל אחד
והוא משתמש ב-Everything ובתיקיות של אותו מחשב בלבד.

לוגים
-----
מידע התקנה + המפתח לאתר:
  %LOCALAPPDATA%\NetunimDocumentBridge\INSTALLATION-LOG.txt

לוג Bridge:
  %LOCALAPPDATA%\NetunimDocumentBridge\bridge.log

פלט הקונסולה של Bridge:
  %LOCALAPPDATA%\NetunimDocumentBridge\bridge-console.log

לוג התקנת ES:
  %LOCALAPPDATA%\NetunimDocumentBridge\install-es.log

שינוי תיקיות:
  %LOCALAPPDATA%\NetunimDocumentBridge\configure_document_bridge.bat

אבטחה
-----
- ה-Bridge מאזין ל-127.0.0.1 בלבד.
- האתר שולח טקסט רגיל ואינו מקבל תחביר Everything חופשי.
- החיפוש מוגבל לתיקיות שהוגדרו מקומית בכל מחשב.
- פתיחת קובץ נעשית רק לפי מזהה זמני של תוצאה שה-Bridge עצמו החזיר.
- הקבצים ותוכן החיפוש אינם מועלים לאתר או ל-Supabase.
