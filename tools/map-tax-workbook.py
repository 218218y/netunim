"""Read-only formula/dependency inventory; never exports personal input/cached values."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('workbook',type=Path)
parser.add_argument('--output',type=Path,required=True)
args=parser.parse_args()
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main','r':'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
ref=re.compile(r"(?:'[^']+'!|[^\W\d]\w*!)?\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?")
mapping={'מחשבון':'Annual input/result UI','תעריפים וכללים':'Versioned nine-group ruleset','ביקורת':'Synthetic regression tests and audit UI; personal examples excluded','משפחה וארנונה':'Permanent profile and independent annual snapshot','חישוב':'Pure integer-money compute.js','עדכון שנתי':'Israel calendar default plus explicit per-group review'}
result={'sourceSha256':hashlib.sha256(args.workbook.read_bytes()).hexdigest(),'privacy':'No input values, cached results, names or dates of birth are exported. Audit formulas expose dependencies only.','sheets':[]}
with zipfile.ZipFile(args.workbook) as archive:
    workbook=ET.fromstring(archive.read('xl/workbook.xml'))
    relations={r.get('Id'):r.get('Target') for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
    for sheet in workbook.find('s:sheets',ns):
        name=sheet.get('name');target=relations[sheet.get('{'+ns['r']+'}id')]
        root=ET.fromstring(archive.read(target.lstrip('/') if target.startswith('/') else 'xl/'+target))
        formulas=[]
        for cell in root.findall('.//s:sheetData/s:row/s:c',ns):
            formula=cell.find('s:f',ns)
            if formula is not None:
                text=formula.text or ''
                record={'cell':cell.get('r'),'references':sorted(set(ref.findall(text))),'functions':sorted(set(re.findall(r'([A-Z][A-Z0-9_]*)\(',text)))}
                if name!='ביקורת':record['formula']=text
                formulas.append(record)
        result['sheets'].append({'name':name,'implementation':mapping.get(name,'Review required'),'formulas':formulas,'validationRanges':[v.get('sqref') for v in root.findall('.//s:dataValidation',ns)]})
args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print('Mapped',len(result['sheets']),'sheets;',sum(len(s['formulas']) for s in result['sheets']),'formulas; personal/cached values excluded')
