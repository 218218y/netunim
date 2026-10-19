from pathlib import Path
import argparse
import zipfile, xml.etree.ElementTree as E, re, json, hashlib
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime,timedelta

parser=argparse.ArgumentParser(description='Independently interpret original formulas using synthetic inputs, without cached Excel results.')
parser.add_argument('workbook',type=Path)
parser.add_argument('--output',type=Path,default=Path('tests/fixtures/tax-workbook-regression.json'))
args=parser.parse_args()
source=args.workbook
ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
cells={};formulas={}
with zipfile.ZipFile(source) as z:
    strings=[''.join(e.itertext()) for e in E.fromstring(z.read('xl/sharedStrings.xml'))]
    for index,sheet in enumerate(E.fromstring(z.read('xl/workbook.xml')).find('x:sheets',ns),1):
        name=sheet.get('name')
        for c in E.fromstring(z.read(f'xl/worksheets/sheet{index}.xml')).findall('.//x:sheetData/x:row/x:c',ns):
            v=c.find('x:v',ns);f=c.find('x:f',ns);value=v.text if v is not None and v.text else ''
            if f is not None:formulas[name,c.get('r')]=f.text;continue
            if c.get('t')=='s':value=strings[int(value)]
            elif c.get('t')=='inlineStr':value=''.join(c.find('x:is',ns).itertext())
            elif value and c.get('t') not in ('str','e'):value=Decimal(value)
            cells[name,c.get('r')]=value

pattern=re.compile(r'''\s*(?:(?P<ref>(?:'[^']+'!|[^\W\d]\w*!)?\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?)|(?P<num>\d+(?:\.\d*)?(?:E[+-]?\d+)?)|(?P<str>"(?:[^"]|"")*")|(?P<fn>[A-Z][A-Z0-9_]*)|(?P<op><>|<=|>=|[=<>+*/^%&(),-]))''')
prec={'=':1,'<>':1,'<':1,'>':1,'<=':1,'>=':1,'&':2,'+':3,'-':3,'*':4,'/':4,'^':5}
def parse(text):
    tokens=[];pos=0
    while pos<len(text):
        match=pattern.match(text,pos)
        if not match:raise ValueError(text[pos:])
        tokens.append((match.lastgroup,match.group(match.lastgroup)));pos=match.end()
    cursor=0
    def expression(minimum=0):
        nonlocal cursor
        typ,value=tokens[cursor];cursor+=1
        if value in ('+','-'):node=('unary',value,expression(6))
        elif value=='(':node=expression();assert tokens[cursor][1]==')';cursor+=1
        elif typ=='fn':
            assert tokens[cursor][1]=='(';cursor+=1;args=[]
            if tokens[cursor][1]!=')':
                while True:
                    args.append(expression())
                    if tokens[cursor][1]!=',':break
                    cursor+=1
            assert tokens[cursor][1]==')';cursor+=1;node=('call',value,args)
        else:node=(typ,value)
        while cursor<len(tokens):
            op=tokens[cursor][1]
            if op=='%':cursor+=1;node=('binary','/',node,('num','100'));continue
            if op not in prec or prec[op]<minimum:break
            cursor+=1;node=('binary',op,node,expression(prec[op]+1))
        return node
    result=expression();assert cursor==len(tokens),(text,tokens[cursor:]);return result

class Workbook:
    def __init__(self,overrides):self.overrides=overrides;self.memo={}
    def cell(self,sheet,address):
        key=sheet,address.replace('$','')
        if key in self.overrides:return self.overrides[key]
        if key not in self.memo:self.memo[key]=self.eval(parse(formulas[key]),sheet) if key in formulas else cells.get(key,'')
        return self.memo[key]
    def eval(self,node,sheet):
        typ,value,*rest=node
        if typ=='num':return Decimal(value)
        if typ=='str':return value[1:-1].replace('""','"')
        if typ=='ref':
            if '!' in value:target,address=value.split('!');target=target.strip("'")
            else:target,address=sheet,value
            address=address.replace('$','')
            if ':' not in address:return self.cell(target,address)
            start,end=address.split(':');a=re.fullmatch(r'([A-Z]+)(\d+)',start);b=re.fullmatch(r'([A-Z]+)(\d+)',end)
            return [self.cell(target,chr(col)+str(row)) for row in range(int(a[2]),int(b[2])+1) for col in range(ord(a[1]),ord(b[1])+1)]
        if typ=='unary':return self.eval(rest[0],sheet)*(-1 if value=='-' else 1)
        if typ=='binary':
            a,b=[self.eval(v,sheet) for v in rest]
            if value=='&':return str(a)+str(b)
            if value in ['=','<>','<','>','<=','>=']:
                return {'=':lambda:a==b,'<>':lambda:a!=b,'<':lambda:a<b,'>':lambda:a>b,'<=':lambda:a<=b,'>=':lambda:a>=b}[value]()
            a=Decimal(0) if a=='' else a;b=Decimal(0) if b=='' else b
            return {'+':lambda:a+b,'-':lambda:a-b,'*':lambda:a*b,'/':lambda:a/b,'^':lambda:a**b}[value]()
        args=rest[0]
        if value=='IF':return self.eval(args[1 if self.eval(args[0],sheet) else 2],sheet)
        values=[self.eval(v,sheet) for v in args]
        flatten=lambda seq:[x for v in seq for x in (v if isinstance(v,list) else [v])]
        if value=='SUM':return sum((v for v in flatten(values) if isinstance(v,Decimal)),Decimal(0))
        if value in ('MIN','MAX'):return (min if value=='MIN' else max)(flatten(values))
        if value in ('OR','AND'):return (any if value=='OR' else all)(values)
        if value=='TODAY':return Decimal((datetime(2026,10,19)-datetime(1899,12,30)).days)
        if value=='YEAR':return Decimal((datetime(1899,12,30)+timedelta(days=int(values[0]))).year)
        if value=='COUNTIFS':
            def criterion(a,b):
                for op in ['>=','<=','<>','>','<','=']:
                    if b.startswith(op):return self.eval(('binary',op,('num',str(a or 0)),('num',b[len(op):])),sheet)
                return a==b
            return Decimal(sum(all(criterion(values[j][idx],values[j+1]) for j in range(0,len(values),2)) for idx in range(len(values[0]))))
        raise ValueError(value)

cases=[
 {'label':'annual-deduction-rental','revenue':180000,'expensesMonthly':1000,'inputVatMonthly':180,'pensionActual':14000,'rentMonthly':6000,'rentExpenses':1200,'rentPaidMonthly':4000,'householdOtherMonthly':500,'arnonaAnnual':6000,'adults':2},
 {'label':'monthly-including-vat-credit','revenue':29500,'revenuePeriod':'monthly','vatIncluded':True,'expensesMonthly':1500,'inputVatMonthly':270,'pensionActual':18000,'pensionMethod':'credit','rentMonthly':4000,'arnonaAnnual':5000,'adults':4},
 {'label':'high-income-flat-surtax','revenue':1000000,'expensesMonthly':2000,'pensionActual':30000,'pensionMethod':'credit','extraPensionCredit':True,'rentMonthly':20000,'rentExpenses':6000,'rentRoute':'flat','arnonaAnnual':8000,'adults':12},
 {'label':'manual-pension-ordinary','revenue':500000,'expensesMonthly':4000,'pensionActual':16000,'pensionMethod':'manual','pensionDeduction':5000,'pensionCredit':1000,'rentMonthly':12000,'rentExpenses':10000,'rentRoute':'ordinary','over60':True,'arnonaAnnual':7000,'adults':3}
]
money_fields=['revenue','expensesMonthly','inputVatMonthly','pensionActual','pensionDeduction','pensionCredit','rentMonthly','rentExpenses','arnonaAnnual','rentPaidMonthly','householdOtherMonthly','otherResidentsMonthly']
results=[]
for case in cases:
    i={'revenue':0,'revenuePeriod':'annual','vatIncluded':False,'expensesMonthly':0,'inputVatMonthly':0,'activeSelfEmployed':True,'pensionRequired':True,'pensionActual':0,'pensionMethod':'deduction','extraPensionCredit':False,'pensionDeduction':0,'pensionCredit':0,'rentMonthly':0,'rentExpenses':0,'rentRoute':'auto','over60':False,'rentEligible':True,'arnonaAnnual':0,'rentPaidMonthly':0,'householdOtherMonthly':0,'otherResidentsMonthly':0,'adults':1,**case}
    yes=lambda b:'כן' if b else 'לא'
    refs={'B6':i['revenue'],'B7':'שנתי' if i['revenuePeriod']=='annual' else 'חודשי','B8':'כולל מע״מ' if i['vatIncluded'] else 'ללא מע״מ — דוח רווח והפסד','B9':i['expensesMonthly'],'B10':i['inputVatMonthly'],'B11':yes(i['activeSelfEmployed']),'B14':yes(i['pensionRequired']),'B15':i['pensionActual'],'B16':{'deduction':'ניכוי קודם','credit':'זיכוי קודם','manual':'ידני'}[i['pensionMethod']],'B17':yes(i['extraPensionCredit']),'B18':i['pensionDeduction'],'B19':i['pensionCredit'],'B22':i['rentMonthly'],'B23':i['rentExpenses'],'B24':{'auto':'אוטומטי - הנמוך','flat':'10%','ordinary':'פטור-רגיל'}[i['rentRoute']],'B25':yes(i['over60']),'B26':yes(i['rentEligible']),'B29':i['arnonaAnnual'],'B32':i['rentPaidMonthly'],'B33':i['householdOtherMonthly'],'B34':i['otherResidentsMonthly'],'B35':i['adults'],'B39':''}
    overrides={('מחשבון',k):Decimal(v) if isinstance(v,(int,float)) else v for k,v in refs.items()}
    overrides.update({('משפחה וארנונה','B7'):Decimal('2.25'),('משפחה וארנונה','B8'):Decimal(0)})
    for row in range(13,21):
        for column in ['B','C','D','E','F']:overrides['משפחה וארנונה',column+str(row)]='' if column in ['B','C','F'] else Decimal(0)
        overrides['משפחה וארנונה','G'+str(row)]='לא'
    wb=Workbook(overrides)
    output={key:int((wb.cell('חישוב',cell)*100).quantize(Decimal(1),rounding=ROUND_HALF_UP)) for key,cell in {'revenue':'G7','profit':'G12','outputVat':'G8','inputVat':'G9','netVat':'G10','national':'G16','health':'G17','pensionMinimum':'G14','pension':'G15','taxable':'G20','incomeTax':'G23','arnona':'G26','net':'G28'}.items()}
    i.pop('adults');i.pop('label');i={k:int(v*100) if k in money_fields else v for k,v in i.items()}
    eligible=i.pop('rentEligible');route=i.pop('rentRoute')
    i['rentMode']='other-ordinary' if not eligible else {'auto':'residential-auto','ordinary':'residential-exemption','flat':'residential-flat','none':'excluded'}[route]
    results.append({'label':case['label'],'profile':{'adults':case.get('adults',1),'basePoints':2.25},'input':i,'expected':output})
args.output.write_text(json.dumps({'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'method':'Original formula text evaluated independently with Python Decimal and synthetic inputs. No cached Excel values or personal examples. Tolerance: 5 agorot for explicit per-step rounding.','cases':results},ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('Generated',len(results),'synthetic original-formula regression cases')
