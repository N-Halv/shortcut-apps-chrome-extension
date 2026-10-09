// Pure move planning for the Group button, shared with the tests.

// Given every tab in one window and the app tabs in the order they should
// appear, return the moves that pull them to the left of the strip.
//
// Chrome keeps pinned tabs at the front of the strip and will not let an
// unpinned tab sit before them, so the two sets get their own runs: pinned app
// tabs from index 0, unpinned ones from just after the last pinned tab.
export function planMoves(windowTabs, orderedTabIds) {
  const pinned = new Set(windowTabs.filter((tab) => tab.pinned).map((tab) => tab.id));

  let pinnedIndex = 0;
  let index = pinned.size;

  return orderedTabIds.map((id) => ({
    id,
    index: pinned.has(id) ? pinnedIndex++ : index++,
  }));
}
