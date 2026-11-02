import {readMorningReportBundle} from './morning-report-reader.js';
import {createMorningReportCache} from './morning-report-cache.js';
import {buildMorningReport,reportMetric} from './morning-report-model.js';
import {expenseBimonth} from '../../core/morning-report-period.js';
import {expenseMoney} from './morning-expense-table.js';
import {esc} from '../../core/values.js';

export function createExpenseVatSummary({request,capabilities,capture,run,render}){
  const cache=createMorningReportCache();let controller=null,revision=0,key='',status='',cents=null;
  function reset(){revision++;controller?.abort();controller=null;key='';status='';cents=null;cache.clear();}
  function load(periodKey){
    reset();key=periodKey;if(!key){render();return false;}
    if(typeof request!=='function'){status='unavailable';render();return false;}
    let period,caps,scope;
    try{period=expenseBimonth(key+'-01');caps=capabilities();scope=capture();scope();if(!caps?.environment)throw Error('unavailable');}
    catch{status='error';render();return false;}
    const epoch=revision;
    controller=new AbortController();const signal=controller.signal;
    const check=()=>{scope();if(epoch!==revision||signal.aborted)throw new DOMException('Cancelled','AbortError');};
    status='loading';render();
    return run(async()=>{
      try{
        const bundle=await readMorningReportBundle({request,cache,scope,assertCurrent:check,environment:caps.environment,
          fromDate:period.fromDate,toDate:period.toDate,reportType:'vat',signal});check();
        if(bundle.environment!==caps.environment)throw Error('morning_report_environment_mismatch');
        const report=buildMorningReport({...bundle,fromDate:period.fromDate,toDate:period.toDate,group:'bimonth'});
        cents=reportMetric(report.total,'vatBalanceCents');
        if(cents===null||bundle.errors.length)throw Error('incomplete_vat_report');
        status='ready';
      }catch(error){if(epoch===revision&&error.name!=='AbortError'){status='error';cents=null;}}
      finally{if(epoch===revision){controller=null;render();}}
    });
  }
  function markup(){
    const label=status==='ready'?(cents<0?'מע״מ להחזר':'מע״מ לתשלום'):'מע״מ לתשלום';
    const detail=!key?'בחרו תקופת דיווח':status==='loading'?'טוען סיכום ממורנינג…':status==='ready'?expenseBimonth(key+'-01').label:'הסיכום אינו זמין · אפשר לרענן את הרשימה';
    return `<div class="morning-expense-vat-summary" data-expense-vat-summary role="status" aria-live="polite"><strong>${label}: <bdi>${status==='ready'?esc(expenseMoney(Math.abs(cents))):'—'}</bdi></strong><small>${esc(detail)}</small></div>`;
  }
  return {load,reset,markup};
}
