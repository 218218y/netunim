import {validReportDate} from './morning-report-period.js';

// Dates and net thresholds follow the Tax Authority's published 2026 schedule.
// This is a presence rule for this business intake, never official validation.
export function allocationPolicy({date,documentType,netCents,vatCents,pcnClassification='T'}){
  if(!validReportDate(date)||!Number.isSafeInteger(netCents)||!Number.isSafeInteger(vatCents))return {status:'unknown',thresholdCents:null};
  if(pcnClassification==='P'||![305,320].includes(documentType))return {status:'separate_treatment',thresholdCents:null};
  const thresholdCents=date>='2026-06-01'?500000:date>='2026-01-01'?1000000:date>='2025-01-01'?2000000:null;
  return {status:thresholdCents===null?'unknown':vatCents>0&&netCents>thresholdCents?'check_business_conditions':'below_threshold_or_no_vat',thresholdCents,officiallyValidated:false};
}
