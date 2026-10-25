"""Bounded crash/control experiment, preserving every failure without retries."""
import argparse
import json
from pathlib import Path
import platform
import sys
import time

from browser_harness import ROOT
from acceptance_safety import write_evidence
from crash_evidence import capture_stopped_indexeddb,classify_failure,snapshot_digest
from runtime_restore_server_recovery import paired_process_boundaries


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app',choices=('orders','kupa'),required=True)
    parser.add_argument('--restart',choices=('crash','graceful'),required=True)
    parser.add_argument('--repetitions',type=int,choices=(1,2,3),default=2)
    parser.add_argument('--phase',action='append',choices=('prepared','shared-applied','main-applied'))
    parser.add_argument('--report-dir',type=Path,required=True)
    args=parser.parse_args()
    directory=args.report_dir.resolve()
    directory.mkdir(parents=True,exist_ok=True)
    samples=[]
    report={'schemaVersion':1,'application':args.app,'restart':args.restart,
            'windowsVersion':platform.platform(),'physicalAcceptance':False,
            'automaticRetry':False,'samples':samples,'complete':False}
    def save():
        source=write_evidence('restore-investigation-'+args.app+'-'+args.restart,samples)
        report['source']={key:value for key,value in source.items() if key!='scenarios'}
        (directory/'summary.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf8')
    save()
    for repetition in range(1,args.repetitions+1):
        for phase in args.phase or ('prepared','shared-applied','main-applied'):
            sample={'repetition':repetition,'phase':phase,'status':'RUNNING','observation':{}}
            samples.append(sample)
            started=time.monotonic()
            name=f'{repetition}-{phase}'
            def capture(browser):
                sample['stoppedProfile']=capture_stopped_indexeddb(browser,directory/name)
            try:
                paired_process_boundaries(args.app,phases=(phase,),crash=args.restart=='crash',
                    observation=sample['observation'],capture_stopped=capture)
                sample.update(status='PASS',classification='preserved-paired-recovery')
            except Exception as error:
                sample.update(status='FAIL',classification=classify_failure(error),
                    errorType=type(error).__name__,message=str(error),notes=getattr(error,'__notes__',[]))
            sample['seconds']=round(time.monotonic()-started,3)
            sample['snapshotDigests']={key:snapshot_digest(value) for key,value in sample['observation'].items()
                if key in ('before','restarted','completed','stableRestart','storedBefore','storedRestarted','storedCompleted')}
            save()
            print(json.dumps({key:value for key,value in sample.items()
                if key not in ('observation','stoppedProfile','notes')},ensure_ascii=False),flush=True)
    report['complete']=True
    report['decision']='unresolved' if any(row['status']=='FAIL' for row in samples) else 'not-reproduced-in-bounded-samples'
    save()
    return int(any(row['status']!='PASS' for row in samples))


if __name__=='__main__':
    raise SystemExit(main())
