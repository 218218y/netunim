// @ts-check
// Canonical text matching for the Bridge, DOM previews and classic spreadsheet
// worker. sync-assets generates the worker script from this dependency-free ESM.
/**
 * @typedef {'phrase'|'all'|'any'|'proximity'} ContentMatchMode
 * @typedef {{matchMode:ContentMatchMode,wordMatch:'partial'|'whole',proximityWords:number}} ContentSearchOptions
 * @typedef {{start:number,end:number}} TextMatchRange
 * @typedef {{matches:TextMatchRange[],capped:boolean,foundTerms:string[]}} TextMatchResult
 * @typedef {{text:string,range:(start:number,end:number)=>TextMatchRange}} FoldedText
 * @typedef {{maxMatches?:number,matchMode?:ContentMatchMode}} MatchCollectionOptions
 * @typedef {{needle:string,search:ContentSearchOptions,requiredTerms:readonly string[],
 * find:(value:unknown,options?:MatchCollectionOptions)=>TextMatchResult}} DocumentTextMatcher
 */
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const MODES = new Set(['phrase', 'all', 'any', 'proximity']);
const PHONE_IGNORED = /[\s\u002d\u2010-\u2015\u2212\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** @param {unknown} value */
function lower(value) { return String(value ?? '').toLocaleLowerCase('he-IL'); }
/** @param {string} value */
function literal(value) { return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&'); }
/** @param {unknown} value @returns {value is ContentMatchMode} */
function validMode(value) { return typeof value === 'string' && MODES.has(value); }

/** @param {unknown} [value] @returns {ContentSearchOptions} */
function normalizeContentSearch(value = {}) {
  const source = value && typeof value === 'object' ? /** @type {Record<string,unknown>} */ (value) : {};
  return {
    matchMode: validMode(source.matchMode) ? source.matchMode : 'phrase',
    wordMatch: source.wordMatch === 'whole' ? 'whole' : 'partial',
    proximityWords: Math.max(0, Math.min(50, Math.trunc(Number(source.proximityWords) || 0))),
  };
}

/** @param {unknown} query */
function contentSearchTerms(query) {
  return String(query ?? '').trim().split(/\s+/u).filter(Boolean).slice(0, 16);
}

/** @param {string} source @param {number} start @param {number} end */
function isWholeWordTextRange(source, start, end) {
  // Read code points at both boundaries, including letters outside the BMP.
  const before = start > 0 ? String.fromCodePoint(source.codePointAt(
    start > 1 && /[\uDC00-\uDFFF]/u.test(source[start - 1] || '') && /[\uD800-\uDBFF]/u.test(source[start - 2] || '')
      ? start - 2 : start - 1) ?? 0) : '';
  const after = end < source.length ? String.fromCodePoint(source.codePointAt(end) ?? 0) : '';
  return (!before || !WORD_CHAR.test(before)) && (!after || !WORD_CHAR.test(after));
}

/** @param {string} value */
function phoneDigits(value) {
  const digits = value.replace(PHONE_IGNORED, '');
  return /^\d{7,15}$/.test(digits) ? digits : '';
}

/** @param {string} source @returns {FoldedText} */
function foldedSource(source) {
  const text = lower(source);
  if (text.length === source.length) return {text, range: (start, end) => ({start, end})};
  // Lowercasing can expand a code point (for example U+0130). Keep highlights
  // in original UTF-16 coordinates rather than shifting every subsequent match.
  /** @type {number[]} */ const starts = [];
  /** @type {number[]} */ const ends = [];
  let offset = 0;
  for (const char of source) {
    for (let i = 0; i < lower(char).length; i++) {
      starts.push(offset);
      ends.push(offset + char.length);
    }
    offset += char.length;
  }
  return {text, range: (start, end) => {
    const originalStart = starts[start], originalEnd = ends[end - 1];
    if (originalStart === undefined || originalEnd === undefined) throw new RangeError('document_text_range_out_of_bounds');
    return {start: originalStart, end: originalEnd};
  }};
}

/** @param {string} source @param {FoldedText} folded @param {string[]} terms
 * @param {ContentSearchOptions} search @param {number} limit @returns {TextMatchRange[]} */
function proximityRanges(source, folded, terms, search, limit) {
  const tokens = Array.from(folded.text.matchAll(/\S+/gu), match => ({
    text: match[0], start: match.index, end: match.index + match[0].length,
  }));
  let suffixEnds = new Int32Array(tokens.length).fill(-1);
  const whole = search.wordMatch === 'whole';
  /** @param {number} start @param {number} end */
  const boundary = (start, end) => {
    const range = folded.range(start, end);
    return !whole || isWholeWordTextRange(source, range.start, range.end);
  };
  const last = terms[terms.length - 1], first = terms[0];
  if (!first || !last) return [];
  for (const [i, token] of tokens.entries()) {
    const end = token.start + last.length;
    if (token.text.startsWith(last) && boundary(token.start, end)) suffixEnds[i] = end;
  }
  // Dynamic programming over token positions. Each stage records the rightmost
  // viable successor in the distance window, preserving the old greedy ranges.
  // Work is O(terms * tokens), including a long missing suffix; no backtracking.
  for (let stage = terms.length - 2; stage >= 0; stage--) {
    const rightmost = new Int32Array(tokens.length);
    let latest = -1;
    for (let i = 0; i < tokens.length; i++) {
      if ((suffixEnds[i] ?? -1) >= 0) latest = i;
      rightmost[i] = latest;
    }
    const ends = new Int32Array(tokens.length).fill(-1), term = terms[stage];
    if (term === undefined) throw new RangeError('document_search_term_out_of_bounds');
    for (const [i, token] of tokens.entries()) {
      if (stage === 0 ? !token.text.endsWith(term) : token.text !== term) continue;
      const start = stage === 0 ? token.end - term.length : token.start;
      if (!boundary(start, token.end)) continue;
      const next = rightmost[Math.min(tokens.length - 1, i + search.proximityWords + 1)] ?? -1;
      if (next > i) ends[i] = suffixEnds[next] ?? -1;
    }
    suffixEnds = ends;
  }
  /** @type {TextMatchRange[]} */ const matches = [];
  let cursor = 0;
  for (let i = 0; i < tokens.length && matches.length < limit; i++) {
    const token = tokens[i];
    if (!token) throw new RangeError('document_search_token_out_of_bounds');
    const start = token.end - first.length, end = suffixEnds[i] ?? -1;
    if (end >= 0 && start >= cursor) {
      matches.push(folded.range(start, end));
      cursor = end;
    }
  }
  return matches;
}

/** @param {unknown} query @param {unknown} [options] @returns {DocumentTextMatcher} */
function createDocumentTextMatcher(query, options = {}) {
  const needle = String(query ?? '').replace(/\s+/gu, ' ').trim();
  const search = normalizeContentSearch(options), terms = contentSearchTerms(needle).map(lower);
  const digits = phoneDigits(needle), requiredTerms = digits ? [digits] : [...new Set(terms)];
  const phonePattern = digits ? new RegExp([2, 3].filter(n => n < digits.length).map(n =>
    `${literal(digits.slice(0, n))}(?:\\s|[-‐‑‒–—―−])?${literal(digits.slice(n))}`).join('|'), 'gu') : null;

  /** @param {unknown} value @param {MatchCollectionOptions} [options] @returns {TextMatchResult} */
  function find(value, {maxMatches = 5000, matchMode = search.matchMode} = {}) {
    const source = String(value ?? ''), limit = Math.max(1, Math.min(20000, Math.trunc(Number(maxMatches) || 5000)));
    /** @type {TextMatchResult} */ const empty = {matches: [], capped: false, foundTerms: []};
    if (!source || needle.length < 2) return empty;
    const whole = search.wordMatch === 'whole';
    if (phonePattern) {
      const matches = [];
      phonePattern.lastIndex = 0;
      let match;
      while ((match = phonePattern.exec(source))) {
        const end = match.index + (match[0] || '').length;
        if (!whole || isWholeWordTextRange(source, match.index, end)) matches.push({start: match.index, end});
        if (matches.length >= limit) break;
      }
      return {matches, capped: matches.length >= limit, foundTerms: matches.length ? requiredTerms : []};
    }
    const folded = foldedSource(source);
    if (matchMode === 'proximity' && terms.length > 1) {
      const matches = proximityRanges(source, folded, terms, search, limit);
      return {matches, capped: matches.length >= limit, foundTerms: matches.length ? requiredTerms : []};
    }
    const multi = (matchMode === 'all' || matchMode === 'any') && terms.length > 1;
    /** @type {TextMatchRange[]} */ const matches = [];
    /** @type {string[]} */ const foundTerms = [];
    for (const term of multi ? requiredTerms : [lower(needle)]) {
      let offset = 0, found = 0;
      while (offset <= folded.text.length - term.length) {
        const index = folded.text.indexOf(term, offset);
        if (index < 0) break;
        const range = folded.range(index, index + term.length);
        if (!whole || isWholeWordTextRange(source, range.start, range.end)) {
          matches.push(range);
          found++;
          if (found >= limit) break;
        }
        offset = index + Math.max(1, whole ? 1 : term.length);
      }
      // Presence is checked for EVERY term independently of the display cap.
      if (found) foundTerms.push(term);
    }
    if (multi && matchMode === 'all' && foundTerms.length !== requiredTerms.length) return empty;
    matches.sort((a, b) => a.start - b.start || b.end - a.end);
    const unique = matches.filter((row, i) => !i || row.start !== matches[i - 1]?.start || row.end !== matches[i - 1]?.end);
    return {matches: unique.slice(0, limit), capped: unique.length >= limit, foundTerms};
  }
  return {needle, search, requiredTerms, find};
}
