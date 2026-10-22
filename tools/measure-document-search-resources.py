"""Opt-in Windows peak working-set/CPU research; synthetic matcher text only."""
from pathlib import Path
import argparse, ctypes, hashlib, json, os, platform, statistics, subprocess, time

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source',type=Path,default=Path('shared/document-text-search.js'))
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--samples',type=int,default=3)
parser.add_argument('--alphabet',choices=('hebrew','ascii'),default='hebrew')
args=parser.parse_args()
if os.name!='nt':parser.error('Windows is required for PeakWorkingSetSize evidence')
if not 1<=args.samples<=5:parser.error('samples must be between 1 and 5')
ROOT=Path(__file__).resolve().parents[1]
source=args.source.resolve(strict=True)
class Counters(ctypes.Structure):
 _fields_=[('cb',ctypes.c_ulong),('PageFaultCount',ctypes.c_ulong),*[(name,ctypes.c_size_t) for name in ('PeakWorkingSetSize','WorkingSetSize','QuotaPeakPagedPoolUsage','QuotaPagedPoolUsage','QuotaPeakNonPagedPoolUsage','QuotaNonPagedPoolUsage','PagefileUsage','PeakPagefileUsage')]]
get_memory=ctypes.WinDLL('psapi',use_last_error=True).GetProcessMemoryInfo
get_memory.argtypes=[ctypes.c_void_p,ctypes.POINTER(Counters),ctypes.c_ulong]
rows=[]
for mib in (.5,2,4,8):
 for scenario in ('missing-suffix','first-match','display-cap'):
  for sample in range(args.samples):
   command=['node','--max-old-space-size=512','--expose-gc',str(ROOT/'tools/measure-document-search-resources.mjs'),str(source),str(int(mib*1024*1024)),scenario,args.alphabet]
   process=subprocess.Popen(command,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
   peak=0;deadline=time.monotonic()+30
   try:
    while process.poll() is None:
     counters=Counters();counters.cb=ctypes.sizeof(counters)
     if get_memory(ctypes.c_void_p(int(process._handle)),ctypes.byref(counters),counters.cb):peak=max(peak,counters.PeakWorkingSetSize)
     if time.monotonic()>deadline:raise TimeoutError('owned matcher child exceeded 30 seconds')
     time.sleep(.01)
    stdout,stderr=process.communicate(timeout=2)
    if process.returncode:raise RuntimeError(stderr.decode('utf8',errors='replace'))
    row=json.loads(stdout);row.update(mib=mib,sample=sample,peakWorkingSetBytes=peak)
    if not peak:raise RuntimeError('OS peak memory counter unavailable')
    rows.append(row)
   finally:
    if process.poll() is None:process.kill();process.communicate(timeout=5)
summaries=[]
for mib in (.5,2,4,8):
 for scenario in ('missing-suffix','first-match','display-cap'):
  selected=[row for row in rows if row['mib']==mib and row['scenario']==scenario]
  summaries.append(dict(mib=mib,scenario=scenario,medianMs=statistics.median(row['wallMs'] for row in selected),maxMs=max(row['wallMs'] for row in selected),peakWorkingSetBytes=max(row['peakWorkingSetBytes'] for row in selected)))
report=dict(sourceRevision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),dirty=bool(subprocess.check_output(['git','status','--porcelain'],cwd=ROOT,text=True).strip()),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),driverSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),childSha256=hashlib.sha256((ROOT/'tools/measure-document-search-resources.mjs').read_bytes()).hexdigest(),node=subprocess.check_output(['node','--version'],text=True).strip(),platform=platform.platform(),cpu=os.environ.get('PROCESSOR_IDENTIFIER'),measurement='Windows GetProcessMemoryInfo PeakWorkingSetSize per fresh Node child; includes runtime and input; CPU from child process.cpuUsage',heapLimitMiB=512,samples=args.samples,alphabet=args.alphabet,summaries=summaries,rows=rows)
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
print(json.dumps(summaries,indent=2))
