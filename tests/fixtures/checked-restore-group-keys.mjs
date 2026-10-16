import {createRestoreGroupKeys,RESTORE_GROUP_NAMESPACES} from '../../shared/restore-group-keys.js';
const keys=createRestoreGroupKeys(RESTORE_GROUP_NAMESPACES.orders);
/** @type {string} */ const pending=keys.server('account');
/** @type {unknown} */ const raw='unknown-key';
/** @type {string} */ const decoded=keys.read(raw);
// @ts-expect-error an owner key cannot be a coercible number
keys.server(1);
// @ts-expect-error archive identity must be textual
keys.archive(null);
// @ts-expect-error the application namespace is explicit text
createRestoreGroupKeys({app:'orders'});
// @ts-expect-error validated storage keys are strings, not write receipts
/** @type {boolean} */ const receipt=keys.read(raw);
void [pending,decoded,receipt];
