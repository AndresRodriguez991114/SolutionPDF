export interface ThumbnailSelectionModifiers {
  shiftKey: boolean;
  additive: boolean;
}

export interface ThumbnailSelectionResult {
  selectedPages: Set<number>;
  anchorPageNumber: number;
}

export function updateThumbnailSelection(
  selectedPages: ReadonlySet<number>,
  pageNumber: number,
  anchorPageNumber: number,
  modifiers: ThumbnailSelectionModifiers
): ThumbnailSelectionResult {
  if (modifiers.shiftKey) {
    const next = new Set(modifiers.additive ? selectedPages : []);
    const firstPage = Math.min(anchorPageNumber, pageNumber);
    const lastPage = Math.max(anchorPageNumber, pageNumber);
    for (let page = firstPage; page <= lastPage; page += 1) next.add(page);
    return { selectedPages: next, anchorPageNumber };
  }

  if (modifiers.additive) {
    const next = new Set(selectedPages);
    if (next.has(pageNumber)) next.delete(pageNumber);
    else next.add(pageNumber);
    return { selectedPages: next, anchorPageNumber: pageNumber };
  }

  return { selectedPages: new Set([pageNumber]), anchorPageNumber: pageNumber };
}
