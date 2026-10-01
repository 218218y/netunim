// Keep DOM lookup lazy: result-only callers also create the search controller in tests.
export function globalSearchRefs(){
  const byId=id=>document.getElementById(id);
  return {
    trigger:byId('globalSearchButton'),backdrop:byId('globalSearchBackdrop'),dialog:byId('globalSearchBackdrop')?.querySelector('.global-search-dialog'),workspace:byId('globalSearchWorkspace'),
    input:byId('globalSearchInput'),results:byId('globalSearchResults'),meta:byId('globalSearchMeta'),close:byId('globalSearchClose'),
    filterAll:byId('globalSearchFilterAll'),filterSite:byId('globalSearchFilterSite'),filterFiles:byId('globalSearchFilterFiles'),filterContent:byId('globalSearchFilterContent'),
    pdfRefreshButton:byId('globalSearchPdfRefresh'),pdfRefreshStatus:byId('globalSearchPdfRefreshStatus'),
    contentOptions:byId('globalSearchContentOptions'),contentOptionsButton:byId('globalSearchContentOptionsButton'),contentOptionsMenu:byId('globalSearchContentOptionsMenu'),
    contentModeLabel:byId('globalSearchContentModeLabel'),contentWordLabel:byId('globalSearchContentWordLabel'),
    contentModeButtons:[...document.querySelectorAll('[data-content-match-mode]')],contentWordButtons:[...document.querySelectorAll('[data-content-word-match]')],
    proximityWrap:byId('globalSearchProximityWrap'),proximityWords:byId('globalSearchProximityWords'),folderScope:byId('globalSearchFolderScope'),
    folderPick:byId('globalSearchFolderPick'),folderLabel:byId('globalSearchFolderLabel'),folderClear:byId('globalSearchFolderClear'),
    preview:byId('globalSearchDocumentPreview'),previewBody:byId('globalSearchPreviewBody'),previewMatches:byId('globalSearchPreviewMatches'),splitter:byId('globalSearchDocumentSplitter'),
  };
}
