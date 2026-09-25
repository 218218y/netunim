NETUNIM Document Bridge v2 - חיפוש PDF מקומי עם Everything
===========================================================

מה זה עושה
----------
האתר מדבר רק עם http://127.0.0.1:8766 במחשב שבו פתוח האתר.
ה-Bridge שואל את אינדקס Everything המקומי דרך ES הרשמי של voidtools.
קבצי PDF וטקסט OCR אינם מועלים לאתר או ל-Supabase.

כל מחשב עצמאי
-------------
מתקינים את ה-Bridge בכל מחשב בנפרד. לכל מחשב יש:
- מפתח פרטי משלו;
- רשימת תיקיות משלו;
- אינדקס Everything משלו.
אפשר שבמחשב אחד המסמכים יהיו ב-Y:\ ובמחשב אחר בתיקיית Drive אחרת.

לפני התקנה
----------
1. Everything 1.5 צריך להיות מותקן ופועל.
2. בתוך Everything צריך לוודא שה-PDFים בתיקייה מופיעים בחיפוש רגיל.
3. עבור חיפוש בתוכן צריך להפעיל Content Indexing ל-PDFים ולתיקיות הרצויות.
4. אם זו תיקיית רשת/כונן ממופה, היא צריכה להיות מאונדקסת ב-Everything של אותו מחשב.

התקנה
-----
1. הפעל install_document_bridge.bat.
2. ייפתח חלון Windows רגיל לבחירת תיקיות. אין צורך להקליד נתיב עברי במסך CMD.
3. בחר תיקייה אחת או יותר ולחץ "שמור והמשך".
4. המתקין בודק בפועל לכל תיקייה:
   - האם התיקייה נגישה;
   - כמה PDFים Everything רואה;
   - לכמה PDFים יש Content מאונדקס;
   - האם פלט ES ניתן לפענוח תקין.
5. רק אחרי שה-Bridge החדש באמת עולה ועונה, ההתקנה מסומנת כהצלחה.
6. בסיום נפתח אוטומטית:
   %LOCALAPPDATA%\NetunimDocumentBridge\INSTALLATION-LOG.txt
   בשורות הראשונות שלו נמצא המפתח שצריך להדביק באתר.

באתר
-----
Ctrl+K -> מסמכים במחשב.
בפעם הראשונה הדבק את המפתח מתוך INSTALLATION-LOG.txt.
יש שתי אפשרויות:
- תוכן PDF - ברירת המחדל; מחפש רק בתוכן שכבר מאונדקס ב-Everything.
- שם קובץ - חיפוש מהיר בשם PDF.

פירוש בדיקת ההתקנה
------------------
PDFs visible in Everything = 0
  Everything לא רואה PDFים בתוך התיקייה שנבחרה. צריך לבדוק את ה-root/Folder Indexing.

PDFs visible in Everything > 0
PDFs with indexed content = 0
  הקבצים עצמם קיימים באינדקס אבל Content Indexing אינו מכיל את תוכנם.
  חיפוש בשם יעבוד; חיפוש תוכן לא יעבוד עד שאינדוקס התוכן יוגדר/יושלם.

ES JSON result parsing = FAILED
  זו תקלה טכנית בין ES ל-Bridge; ההתקנה נעצרת ולא מדווחת הצלחה שגויה.

שינוי תיקיות אחר כך
-------------------
הפעל:
  %LOCALAPPDATA%\NetunimDocumentBridge\configure_document_bridge.bat
ייפתח שוב חלון בחירת התיקיות.

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

אבטחה
-----
- ה-Bridge מאזין ל-127.0.0.1 בלבד.
- האתר שולח טקסט רגיל; הוא אינו יכול לשלוח תחביר Everything חופשי.
- ה-Bridge כופה PDF + roots שהוגדרו מקומית.
- פתיחת קובץ נעשית לפי מזהה זמני מתוצאת חיפוש, לא לפי path שהדפדפן שולח.
