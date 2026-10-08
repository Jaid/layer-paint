/**
 * Distributes items into the currently shortest column, which keeps the reading order close to row by row.
 * Heights are measured in column widths: an item’s aspect is its height divided by its width.
 */
export const layoutMasonry = <ItemGeneric>(items: ReadonlyArray<ItemGeneric>, columnCount: number, getAspect: (item: ItemGeneric) => number, gap = 0) => {
  const columns = Array.from({length: Math.max(1, Math.floor(columnCount))}, () => ({
    height: 0,
    items: [] as Array<ItemGeneric>,
  }))
  for (const item of items) {
    const column = columns.reduce((shortest, candidate) => (candidate.height < shortest.height - 1e-6 ? candidate : shortest))
    column.items.push(item)
    column.height += getAspect(item) + gap
  }
  return columns.map(column => column.items)
}
