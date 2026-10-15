import {clone} from '../core/values.js';

// Shared Checks and transport metadata never grant Main journal authority.
export function mainBusinessState(value){const copy=clone(value);delete copy.checks;delete copy._meta;return copy}
