// Reverse only the separately tested cooldown/diagnostic deltas when checking
// immutable historical algorithms. Do not replace whole function bodies.
export function restoreCreditCooldown(source) {
  return source.replaceAll('\r\n','\n')
    .replace("import {creditRetryAfterAt} from '../../shared/credit-cooldown-policy.js';\n",'')
    .replace(/\s*providerRetryAfterAt: (?:raw\.providerRetryAfterAt \|\| raw\.retryAfterAt \|\| null|error\?\.providerRetryAfterAt \|\| error\?\.retryAfterAt \|\| null|base\.providerRetryAfterAt|value\.providerRetryAfterAt \? iso\(value\.providerRetryAfterAt\) : null),?/g,'')
    .replace('correlationId,\n                        },','correlationId\n                        },')
    .replace('creditAutomaticRetryAfterAt(base, Date.now())','creditAutomaticRetryAfterAt(base, Date.parse(base.originalFailureAt || base.at || new Date().toISOString()))')
    .replaceAll('retryAfterAt: retryAfterAt,','...(retryAfterAt ? { retryAfterAt } : {}),')
    .replace('return creditRetryAfterAt({ ...error, at: error?.at || new Date(now).toISOString() }, now);','return new Date(explicit).toISOString();')
    .replace('return creditRetryAfterAt({ ...error, at: error?.at || new Date(base).toISOString(), retryAfterAt: new Date(', 'return new Date(')
    .replace(').toISOString() }, base);',').toISOString();')
    .replaceAll("Date.parse(creditRetryAfterAt(error, time) || '')", "Date.parse(error?.retryAfterAt || '')")
    .replace("Date.parse(creditRetryAfterAt(latest, time) || '')", "Date.parse(latest.retryAfterAt || '')")
    .replace('    retryAfterAt: new Date(retryAt).toISOString(),\n','')
    .replaceAll('providerRetryAfterAt:iso(e?.providerRetryAfterAt),','')
    .replaceAll('retryAfterAt:creditRetryAfterAt(e)', 'retryAfterAt:iso(e?.retryAfterAt)')
    .replace(/\.map\(e=>\(\{\n([\s\S]*?)\n    \}\)\)/g, (_,body)=>'.map(e=>({'+body.replace(/\n\s*/g,'').trim()+'}))');
}

export function restoreRetryAfterRangeGuard(source) {
  return source.replaceAll('\r\n','\n').replace('const date = new Date(time);\n  return Number.isFinite(date.getTime()) ? date.toISOString() : null;',
    'return new Date(time).toISOString();');
}
