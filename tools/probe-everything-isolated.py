"""Opt-in native research: own copied binaries, named index, synthetic files only."""
from pathlib import Path
import argparse,ctypes,hashlib,json,os,shutil,subprocess,time,uuid

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--everything-exe",required=True,type=Path)
parser.add_argument("--es-exe",required=True,type=Path)
parser.add_argument("--output",type=Path)


args=parser.parse_args()
if os.name!="nt":parser.error("Windows is required")
ROOT=Path(__file__).resolve().parents[1]
(ROOT/".work").mkdir(exist_ok=True)
output=args.output or ROOT/".work/everything-isolated-latest.json"
work=ROOT/'.work'/('everything-isolated-'+uuid.uuid4().hex)
work.mkdir();files=work/'fixtures';files.mkdir()
for directory in ('AppData','LocalAppData','Temp'):(work/directory).mkdir()
shutil.copyfile(args.everything_exe.resolve(strict=True),work/'Everything.exe')
shutil.copyfile(args.es_exe.resolve(strict=True),work/'es.exe')
for name,text in {'whole-combining.txt':'alpha beta\u0301','whole-joined.txt':'alpha betamax','whole-punctuation.txt':'alpha beta!','whole-underscore.txt':'alpha beta_','late-valid.txt':'אב '*10000+'אין','short-valid.txt':'אב '*5+'אין','repeated.txt':'אב '*10000,'wrong-order.txt':'אין '+'אב '*1000,'gap-overflow.txt':'אב '*1000+'אחר '*300+'אין','positive.txt':'אב אחד סוף','adjacent.txt':'אב סוף','phone.txt':'050-1234567'}.items():
 (files/name).write_text(text,encoding='utf-8-sig')
instance='NETUNIM_VERIFY_'+uuid.uuid4().hex
settings={'app_data':'0','run_as_admin':'0','run_in_background':'1','show_tray_icon':'0','service':'0',
 'auto_include_fixed_volumes':'0','auto_include_removable_volumes':'0','auto_include_fixed_refs_volumes':'0',
 'auto_include_removable_refs_volumes':'0','ntfs_volume_guids':'','ntfs_volume_paths':'','ntfs_volume_includes':'',
 'refs_volume_guids':'','refs_volume_paths':'','refs_volume_includes':'','folders':str(files),
 'folder_monitor_changes':'0','folder_update_types':'0','check_for_updates_on_startup':'0','update_notification':'0',
 'etp_server_enabled':'0','http_server_enabled':'0'}
ini='[Everything]\n'+''.join(k+'='+v+'\n' for k,v in settings.items())
(work/'Everything.ini').write_text(ini,encoding='utf-8-sig');(work/'isolated.ini').write_text(ini,encoding='utf-8-sig')
env={**os.environ,'APPDATA':str(work/'AppData'),'LOCALAPPDATA':str(work/'LocalAppData'),'TEMP':str(work/'Temp'),'TMP':str(work/'Temp')}
process=subprocess.Popen([str(work/'Everything.exe'),'-instance',instance,'-config',str(work/'isolated.ini'),'-no-db','-startup'],cwd=work,env=env,creationflags=subprocess.CREATE_NO_WINDOW)
report={'instance':instance,'source':{'revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),'coordinatorSha256':hashlib.sha256((ROOT/'netunim-orders/document-bridge/everything-search-coordinator.mjs').read_bytes()).hexdigest()},'binaries':{name:hashlib.sha256((work/name).read_bytes()).hexdigest() for name in ('Everything.exe','es.exe')},'measurements':[],'isolatedIndexVerified':False}
def query(args,timeout=3):
 result=subprocess.run([str(work/'es.exe'),'-instance',instance,*args],cwd=work,env=env,capture_output=True,timeout=timeout,creationflags=subprocess.CREATE_NO_WINDOW)
 return result.returncode,result.stdout.decode('utf-8',errors='replace'),result.stderr.decode('utf-8',errors='replace')
def cpu():
 creation=ctypes.c_ulonglong();exit_time=ctypes.c_ulonglong();kernel=ctypes.c_ulonglong();user=ctypes.c_ulonglong()
 ok=ctypes.windll.kernel32.GetProcessTimes(ctypes.c_void_p(int(process._handle)),ctypes.byref(creation),ctypes.byref(exit_time),ctypes.byref(kernel),ctypes.byref(user))
 if not ok:raise ctypes.WinError()
 return (kernel.value+user.value)/10000000
try:
 deadline=time.monotonic()+8
 while True:
  try:
   rc,version,error=query(['-get-everything-version','-timeout','500','-ipc3'],timeout=1)
   if rc==0:break
  except subprocess.TimeoutExpired:pass
  if process.poll() is not None or time.monotonic()>deadline:raise RuntimeError('isolated Everything did not become ready')
  time.sleep(.05)
 report['everythingVersion']=version.strip()
 rc,all_files,error=query(['-argv','-cp','65001','-ipc3','/a-d','-full-path-and-name','-timeout','1000','--','*'])
 listed=[Path(line.strip()) for line in all_files.splitlines() if line.strip()]
 if rc or not listed or any(not path.is_relative_to(files) for path in listed):raise RuntimeError('isolated index escaped fixture directory: '+repr((rc,all_files,error)))
 if {path.name for path in listed}!={path.name for path in files.iterdir()}:raise RuntimeError('fixture index is incomplete')
 report['isolatedIndexVerified']=True;report['files']=len(listed)
 query_builder="import {buildContentQuery} from './netunim-orders/document-bridge/lib.mjs'; console.log(JSON.stringify([['missing-six',buildContentQuery('אב אב אב אב אב אין',{matchMode:'proximity',proximityWords:50})],['all-terms',buildContentQuery('אב אין',{matchMode:'all'})],['ordered-valid',buildContentQuery('אב סוף',{matchMode:'proximity',proximityWords:1})],['adjacent-valid',buildContentQuery('אב סוף',{matchMode:'proximity',proximityWords:0})]]));"
 planned=json.loads(subprocess.check_output(['node','--input-type=module','-e',query_builder],cwd=ROOT,text=True,encoding='utf-8'))
 planned.append(('read-content', 'late-valid.txt'))
 legacy='regex:content:"'+r'(?:\s+\S+){0,50}\s+'.join(['אב']*5+['אין'])+'" no-background-search:'
 planned.insert(0,('legacy-six',legacy))
 planned.insert(1,('legacy-whole-candidates','whole-words:content:<"alpha" "beta"> no-background-search:'))
 for name,search in planned:
  for sample in range(1):
   before=cpu();start=time.monotonic()
   try:rc,out,error=query(['-argv','-cp','65001','-ipc3',*(['-json','-name','-path-column','-add-columns','content'] if name=='read-content' else ['-full-path-and-name']),'-timeout','1000','--',search],timeout=5)
   except subprocess.TimeoutExpired:rc,out,error='host-timeout','',''
   elapsed=(time.monotonic()-start)*1000;after=cpu();time.sleep(.2);settled=cpu()
   report['measurements'].append({'case':name,'sample':sample,'wallMs':elapsed,'cpuSeconds':after-before,'cpuAfterClientExitSeconds':settled-after,'exitCode':rc,'results':([Path(line).name for line in out.splitlines() if line.strip()] if name!='read-content' else [{'bytes':len(out),'hasSuffix':'אין' in out}]),'stderr':error})
   output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 for mode in ('search','whole-boundaries','abort','timeout'):
  before=cpu();start=time.monotonic()
  result=subprocess.run(['node',str(ROOT/'tools/probe-everything-isolated.mjs'),instance,str(work/'es.exe'),str(work),mode,legacy],cwd=ROOT,env=env,capture_output=True,timeout=8,creationflags=subprocess.CREATE_NO_WINDOW)
  after=cpu();time.sleep(.8);settled=cpu()
  decoded=json.loads(result.stdout.decode('utf8'))
  if result.returncode:raise RuntimeError('actual Bridge probe failed: '+result.stderr.decode('utf8'))
  if mode=='search' and (decoded.get('names')!=['late-valid.txt','short-valid.txt'] or decoded.get('partial') is not False):raise RuntimeError('actual Bridge failed canonical proximity parity')
  if mode=='whole-boundaries' and (decoded.get('names')!=['whole-punctuation.txt','whole-underscore.txt'] or decoded.get('partial') is not False):raise RuntimeError('actual Bridge failed canonical whole-word parity')
  report['measurements'].append({'case':'actual-bridge-'+mode,'wallMs':(time.monotonic()-start)*1000-800,'cpuSeconds':after-before,'cpuAfterClientExitSeconds':settled-after,'exitCode':result.returncode,'output':decoded,'stderr':result.stderr.decode('utf8')})
 print(json.dumps(report,ensure_ascii=False,indent=2))
finally:
 if process.poll() is None:
  try:subprocess.run([str(work/'Everything.exe'),'-instance',instance,'-exit','-wait'],env=env,cwd=work,capture_output=True,timeout=2,creationflags=subprocess.CREATE_NO_WINDOW)
  except Exception:pass
  try:process.wait(timeout=2)
  except subprocess.TimeoutExpired:process.terminate();process.wait(timeout=5)
 report['ownedProcessExited']=process.poll() is not None
 output.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
