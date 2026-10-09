import { strict as assert } from "node:assert";
import test from "node:test";

import { DEFAULT_SETTINGS, effectiveInPageNav, readSettings } from "../settings.js";

test("missing settings fall back to the defaults", () => {
  assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(readSettings({}), { inPageNav: false });
});

test("in-page navigation is off until it is asked for", () => {
  assert.equal(DEFAULT_SETTINGS.inPageNav, false);
});

test("a stored flag is read back", () => {
  assert.equal(readSettings({ inPageNav: true }).inPageNav, true);
  assert.equal(readSettings({ inPageNav: false }).inPageNav, false);
});

// Sync storage outlives any one version of the extension, so a value written
// by something else must not switch the feature on by being merely truthy.
test("only a real boolean true counts as on", () => {
  assert.equal(readSettings({ inPageNav: "yes" }).inPageNav, false);
  assert.equal(readSettings({ inPageNav: 1 }).inPageNav, false);
  assert.equal(readSettings("nonsense").inPageNav, false);
  assert.equal(readSettings([]).inPageNav, false);
});

test("unknown stored keys are dropped rather than carried through", () => {
  assert.deepEqual(readSettings({ inPageNav: true, somethingElse: 7 }), { inPageNav: true });
});

// The setting syncs across machines but the host permission does not, so the
// feature is only live where both are true.
test("in-page navigation needs the setting and the permission", () => {
  assert.equal(effectiveInPageNav({ inPageNav: true }, true), true);
  assert.equal(effectiveInPageNav({ inPageNav: true }, false), false);
  assert.equal(effectiveInPageNav({ inPageNav: false }, true), false);
  assert.equal(effectiveInPageNav({ inPageNav: false }, false), false);
});

test("a missing permission answer is not treated as granted", () => {
  assert.equal(effectiveInPageNav({ inPageNav: true }, undefined), false);
  assert.equal(effectiveInPageNav({ inPageNav: true }, "true"), false);
});
