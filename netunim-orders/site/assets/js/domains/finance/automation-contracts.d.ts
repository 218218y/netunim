import type {FinanceGuard} from '../../shared/finance-fence.js';
import type {FinanceTimers} from '../../shared/finance-browser-effects.js';
import type {PreferencesPort,FinanceKind,PreferenceFailure} from './automation-preferences.js';

export type AutomaticCommand = (options:{interactive:false,auto:true,isCurrent:()=>boolean})=>Promise<unknown>;
export type AutomationPorts = {
  access:{primary:()=>boolean,authenticated:()=>boolean,online:()=>boolean,busy:()=>boolean,capture:()=>FinanceGuard},
  preferences:PreferencesPort,readLastSyncAt:(kind:FinanceKind)=>unknown,
  commands:Record<FinanceKind,AutomaticCommand>,
  onPreferenceFailure?:(kind:FinanceKind,error:PreferenceFailure)=>undefined,
  timers?:FinanceTimers,
};
