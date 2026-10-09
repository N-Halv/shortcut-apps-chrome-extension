// Shared settings shape, used by the popup, the service worker, and the tests.

export const CONTENT_SCRIPT_ID = "app-dock-in-page";

// In-page navigation draws into arbitrary pages, so it needs host access that
// the rest of the dock does not. It stays optional and is only requested when
// the setting is switched on, which keeps the install prompt to storage/tabs.
export const IN_PAGE_ORIGINS = ["http://*/*", "https://*/*"];

// `backgroundColor` is whatever the person typed, handed to CSS untouched; an
// empty string means "use the theme's own background".
export const DEFAULT_SETTINGS = { inPageNav: false, shortcutBar: false, backgroundColor: "" };

// Storage is sync'd and may predate any given setting, so read defensively
// rather than trusting the stored shape.
export function readSettings(stored) {
  const raw = stored && typeof stored === "object" ? stored : {};
  return {
    ...DEFAULT_SETTINGS,
    inPageNav: raw.inPageNav === true,
    shortcutBar: raw.shortcutBar === true,
    backgroundColor: typeof raw.backgroundColor === "string" ? raw.backgroundColor.trim() : "",
  };
}

// Settings sync across machines but permissions do not, so the stored flag is
// an intent and the granted permission is the capability. The feature is only
// actually on when both agree, which is also what the checkbox should show.
export function effectiveInPageNav(settings, granted) {
  return readSettings(settings).inPageNav && granted === true;
}

export function effectiveShortcutBar(settings, granted) {
  return readSettings(settings).shortcutBar && granted === true;
}

// The triangle and the bar are both drawn by the one content script, so it
// only needs to exist while at least one of them is live.
export function needsContentScript(settings, granted) {
  return effectiveInPageNav(settings, granted) || effectiveShortcutBar(settings, granted);
}
