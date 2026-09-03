export const SYNC_EVENT_SKEW_MS=5000;

function eventTime(value){const time=value?Date.parse(value):NaN;return Number.isFinite(time)?time:0}

export function syncEventSuperseded(eventAt,successfulAt,toleranceMs=SYNC_EVENT_SKEW_MS){
  const success=eventTime(successfulAt);if(!success)return false;
  const event=eventTime(eventAt);if(!event)return true;
  return event<success-Math.max(0,Number(toleranceMs)||0);
}

export function syncEventCurrent(eventAt,successfulAt,toleranceMs=SYNC_EVENT_SKEW_MS){return !syncEventSuperseded(eventAt,successfulAt,toleranceMs)}

export function filterCurrentSyncEvents(events,successfulAt,toleranceMs=SYNC_EVENT_SKEW_MS){return (Array.isArray(events)?events:[]).filter(event=>syncEventCurrent(event?.at,successfulAt,toleranceMs))}
