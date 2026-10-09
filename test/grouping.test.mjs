import { strict as assert } from "node:assert";
import test from "node:test";

import { planMoves } from "../grouping.js";
import { findTab } from "../scope.js";

const tab = (id, url, extra = {}) => ({ id, url, windowId: 1, pinned: false, ...extra });

// Mirrors chrome.tabs.move(id, {index}): pull the tab out, reinsert at index.
function applyMoves(windowTabs, moves) {
  const strip = [...windowTabs];
  for (const move of moves) {
    const from = strip.findIndex((candidate) => candidate.id === move.id);
    const [moved] = strip.splice(from, 1);
    strip.splice(move.index, 0, moved);
  }
  return strip.map((candidate) => candidate.id);
}

// ---------------------------------------------------------------- planMoves

test("app tabs land leftmost, in the order given", () => {
  const strip = [tab(1, "https://a.com"), tab(2, "https://b.com"), tab(3, "https://c.com")];
  const moves = planMoves(strip, [3, 1]);

  assert.deepEqual(moves, [
    { id: 3, index: 0 },
    { id: 1, index: 1 },
  ]);
  assert.deepEqual(applyMoves(strip, moves), [3, 1, 2]);
});

test("a full reversal still lands in order", () => {
  const strip = [1, 2, 3, 4, 5].map((id) => tab(id, `https://${id}.com`));
  const moves = planMoves(strip, [5, 4, 3]);

  assert.deepEqual(applyMoves(strip, moves), [5, 4, 3, 1, 2]);
});

test("unpinned app tabs queue up after the pinned ones", () => {
  const strip = [
    tab(1, "https://pinned.com", { pinned: true }),
    tab(2, "https://a.com"),
    tab(3, "https://b.com"),
    tab(4, "https://c.com"),
  ];
  const moves = planMoves(strip, [4, 2]);

  assert.deepEqual(moves, [
    { id: 4, index: 1 },
    { id: 2, index: 2 },
  ]);
  // The pinned tab keeps the front of the strip.
  assert.deepEqual(applyMoves(strip, moves), [1, 4, 2, 3]);
});

test("a pinned app tab sorts within the pinned run, not after it", () => {
  const strip = [
    tab(1, "https://pinned.com", { pinned: true }),
    tab(2, "https://app.com", { pinned: true }),
    tab(3, "https://other.com"),
    tab(4, "https://app2.com"),
  ];
  const moves = planMoves(strip, [4, 2]);

  assert.deepEqual(moves, [
    { id: 4, index: 2 },
    { id: 2, index: 0 },
  ]);
  assert.deepEqual(applyMoves(strip, moves), [2, 1, 4, 3]);
});

test("already-ordered tabs plan to their current places", () => {
  const strip = [tab(1, "https://a.com"), tab(2, "https://b.com")];
  assert.deepEqual(applyMoves(strip, planMoves(strip, [1, 2])), [1, 2]);
});

test("nothing open means nothing to move", () => {
  assert.deepEqual(planMoves([tab(1, "https://a.com")], []), []);
});

// ---------------------------------------------------------------- findTab

const gmail = { id: "gmail", url: "https://mail.google.com/", scope: { host: "mail.google.com" } };

test("the linked tab wins while it is in scope", () => {
  const tabs = [tab(7, "https://mail.google.com/mail/u/0/#inbox"), tab(8, "https://mail.google.com/chat")];
  assert.equal(findTab(gmail, { gmail: 7 }, tabs, new Set([7]))?.id, 7);
});

test("a linked tab that navigated away falls back to adoption", () => {
  const tabs = [tab(7, "https://example.com/"), tab(8, "https://mail.google.com/mail")];
  assert.equal(findTab(gmail, { gmail: 7 }, tabs, new Set([7]))?.id, 8);
});

test("a closed linked tab falls back to adoption", () => {
  const tabs = [tab(9, "https://mail.google.com/mail")];
  assert.equal(findTab(gmail, { gmail: 7 }, tabs, new Set([7]))?.id, 9);
});

test("adoption skips tabs another app already claimed", () => {
  const tabs = [tab(5, "https://mail.google.com/mail"), tab(6, "https://mail.google.com/chat")];
  assert.equal(findTab(gmail, {}, tabs, new Set([5]))?.id, 6);
});

test("adopt:false refuses to claim an unlinked tab", () => {
  const tabs = [tab(5, "https://mail.google.com/mail")];
  assert.equal(findTab({ ...gmail, adopt: false }, {}, tabs, new Set()), null);
});

test("no matching tab resolves to null", () => {
  assert.equal(findTab(gmail, {}, [tab(1, "https://example.com/")], new Set()), null);
});
