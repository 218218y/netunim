// @ts-check
import { createJsonArtifactOwner } from '../../netunim-kupa/bank-bridge/json-artifact-owner.mjs';
/** @type {import('../../netunim-kupa/bank-bridge/json-artifact-owner.mjs').JsonArtifactFiles} */
const files = {
  read: async () => ({ lastError: '' }),
  write: async () => {},
  clear: async () => {},
};
const owner = createJsonArtifactOwner({ files });
/** @type {Promise<void>} */
const completion = owner.update({ lastError: 'fixture', nested: { retained: true } });
void completion;
/** @type {Promise<unknown>} */
const document = owner.read();
void document;
// @ts-expect-error Persisted JSON must be validated before it can become authority.
/** @type {Promise<boolean>} */ const authority = owner.read();
void authority;
// @ts-expect-error Patch commands require a record rather than a status string.
owner.update('completed');
// @ts-expect-error Document commands require a record rather than a clock value.
owner.write(42);
// @ts-expect-error File publication is asynchronous completion, not a UI status.
createJsonArtifactOwner({ files: { ...files, write: async () => 'saved' } });
// @ts-expect-error Clear must provide asynchronous evidence of file completion.
createJsonArtifactOwner({ files: { ...files, clear: () => true } });
/** @type {Promise<string>} */
// @ts-expect-error A published document does not return presentation text.
const wrongReceipt = owner.write({ retained: true });
void wrongReceipt;
