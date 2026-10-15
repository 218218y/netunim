// @ts-check
/** @typedef {import('./preview-text-cache.mjs').PreviewFormField} FormField
 * @typedef {{hasForm:boolean,text:string,formFields:FormField[],formFieldCount:number}} PdfExtractionResult
 */
/** @param {unknown} value @returns {value is Record<string,unknown>} */
const object = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function invalid() {
  return Object.assign(new Error('PDF worker result is invalid.'), {
    code: 'PDF_EXTRACTION_RESULT_INVALID'
  });
}
/** @param {unknown} value @returns {value is number} */
const natural = value =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
/** @param {unknown} value @returns {FormField} */
function field(value) {
  if (
    !object(value) ||
    !natural(value.pageNumber) ||
    value.pageNumber < 1 ||
    !natural(value.annotationIndex) ||
    typeof value.fieldKey !== 'string' ||
    !value.fieldKey ||
    typeof value.fieldName !== 'string' ||
    (value.fieldType !== 'Tx' && value.fieldType !== 'Ch') ||
    typeof value.multiLine !== 'boolean' ||
    !Array.isArray(value.rect) ||
    value.rect.length !== 4 ||
    !value.rect.every(
      number => typeof number === 'number' && Number.isFinite(number)
    ) ||
    !Array.isArray(value.values) ||
    !value.values.length ||
    !value.values.every(text => typeof text === 'string' && !!text)
  )
    throw invalid();
  const [left, bottom, right, top] = value.rect;
  return {
    pageNumber: value.pageNumber,
    annotationIndex: value.annotationIndex,
    fieldKey: value.fieldKey,
    fieldName: value.fieldName,
    fieldType: value.fieldType,
    rect: [left, bottom, right, top],
    values: [...value.values],
    multiLine: value.multiLine
  };
}
/** Decode process output before it can authorize an index entry or a form anchor.
 * Persisted historical entries retain their separate compatibility reader.
 * @param {unknown} value @returns {PdfExtractionResult} */
export function decodePdfExtractionResult(value) {
  if (
    !object(value) ||
    typeof value.hasForm !== 'boolean' ||
    typeof value.text !== 'string' ||
    !natural(value.formFieldCount) ||
    !Array.isArray(value.formFields)
  )
    throw invalid();
  const formFields = value.formFields.map(field);
  const hasForm = formFields.length > 0;
  if (
    value.formFieldCount !== formFields.length ||
    value.hasForm !== hasForm ||
    (value.hasForm ? !value.text : !!value.text)
  )
    throw invalid();
  return {
    hasForm: value.hasForm,
    text: value.text,
    formFieldCount: value.formFieldCount,
    formFields
  };
}
/** @param {string} output @param {string} errors @param {number|null} code @returns {PdfExtractionResult} */
export function decodePdfExtractionResponse(output, errors, code) {
  /** @type {unknown} */ let value;
  try {
    value = JSON.parse(output.trim());
  } catch (error) {
    throw new Error(
      `PDF worker exited ${code}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!object(value) || typeof value.ok !== 'boolean') throw invalid();
  if (!value.ok) {
    if (value.error !== undefined && typeof value.error !== 'string')
      throw invalid();
    throw new Error(
      `PDF worker exited ${code}: ${value.error || errors || 'PDF extraction failed'}`
    );
  }
  // A failed worker cannot publish even if a partial success envelope was flushed.
  if (code !== 0)
    throw new Error(
      `PDF worker exited ${code}: ${errors || 'PDF extraction failed'}`
    );
  return decodePdfExtractionResult(value.result);
}
