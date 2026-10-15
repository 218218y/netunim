import {createLazyGlobalDocumentSearch} from '../../shared/lazy-global-document-search.js';
/** @param {import('../../shared/lazy-global-document-search.js').LazySearchOptions} ports */
export function consumer(ports){const view=createLazyGlobalDocumentSearch(ports);view.bind();void view.open();view.close();return view.dispose()}
// @ts-expect-error A decoded module factory must return a controller, not wire data.
createLazyGlobalDocumentSearch({load:async()=>()=>({phase:'ready'}),navigateItem:()=>false});
// @ts-expect-error A pending import must be awaited before creating the view.
createLazyGlobalDocumentSearch({load:()=>()=>null,navigateItem:()=>false});
