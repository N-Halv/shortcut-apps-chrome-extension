// App Dock — service worker.
//
// Owns the appId -> tabId mapping that makes a bookmark behave like an
// application: the first click opens a tab, later clicks re-focus that same
// tab for as long as it is still somewhere inside the app's scope.
//
// The mapping lives in chrome.storage.session because tab ids are only
// meaningful for the life of the browser session, which is also exactly how
// long the service worker may be asleep between clicks.

import { findTab, inScope } from "./scope.js";
import { planMoves } from "./grouping.js";
import {
  CONTENT_SCRIPT_ID,
  IN_PAGE_ORIGINS,
  effectiveInPageNav,
  readSettings,
} from "./settings.js";

const LINKS_KEY = "links";

// ---------------------------------------------------------------- state

async function getApps() {
  const { apps = [] } = await chrome.storage.sync.get("apps");
  return apps;
}

async function getLinks() {
  const stored = await chrome.storage.session.get(LINKS_KEY);
  return stored[LINKS_KEY] ?? {};
}

async function setLinks(links) {
  await chrome.storage.session.set({ [LINKS_KEY]: links });
}

// ---------------------------------------------------------------- launching

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true });
  }
}

async function launch(appId) {
  const app = (await getApps()).find((candidate) => candidate.id === appId);
  if (!app) return { status: "unknown-app" };

  const links = await getLinks();
  const tabs = await chrome.tabs.query({});
  const existing = findTab(app, links, tabs, new Set(Object.values(links)));

  if (existing) {
    const adopted = links[appId] !== existing.id;
    links[appId] = existing.id;
    await setLinks(links);
    await focusTab(existing);
    return { status: adopted ? "adopted" : "focused" };
  }

  const created = await chrome.tabs.create({ url: app.url });
  links[appId] = created.id;
  await setLinks(links);
  return { status: "opened" };
}

// Gather every live app tab into `targetWindowId` and order them along the
// left of its strip, in app-list order. Nothing is opened, so this only
// touches apps that are already running.
async function group(targetWindowId) {
  const apps = await getApps();
  const links = await getLinks();
  const tabs = await chrome.tabs.query({});
  const claimed = new Set(Object.values(links));

  const ordered = [];
  for (const app of apps) {
    const tab = findTab(app, links, tabs, claimed);
    if (!tab) {
      delete links[app.id];
      continue;
    }
    links[app.id] = tab.id;
    claimed.add(tab.id);
    ordered.push(tab);
  }
  await setLinks(links);
  if (ordered.length === 0) return { status: "grouped", moved: 0, gathered: 0 };

  // The popup passes the window it was opened from. The fallback only matters
  // if that lookup failed.
  const windowId =
    targetWindowId ??
    (await chrome.windows.getLastFocused({ windowTypes: ["normal"] }).catch(() => null))?.id;
  if (typeof windowId !== "number") return { status: "no-window", moved: 0, gathered: 0 };

  // Phase 1: pull strays in, appended for now. A window whose last tab leaves
  // is closed by Chrome, which is the right outcome for a window that held
  // nothing but one app.
  let gathered = 0;
  for (const tab of ordered) {
    if (tab.windowId === windowId) continue;
    const landed = await chrome.tabs
      .move(tab.id, { windowId, index: -1 })
      .then(() => true, () => false);
    if (landed) gathered += 1;
  }

  // Phase 2: order them. Re-query, because phase 1 rewrote the strip and the
  // pinned flags of the arriving tabs matter to the plan.
  const windowTabs = await chrome.tabs.query({ windowId });
  const present = new Set(windowTabs.map((tab) => tab.id));
  const orderedIds = ordered.map((tab) => tab.id).filter((id) => present.has(id));

  let moved = 0;
  // Sequential single-tab moves: each move reshuffles the indices around it,
  // so moving to a rising target index lands the run in order.
  for (const move of planMoves(windowTabs, orderedIds)) {
    await chrome.tabs.move(move.id, { index: move.index }).catch(() => {});
    moved += 1;
  }

  return { status: "grouped", moved, gathered };
}

// Send an app's tab back to its launch URL, discarding whatever route it
// wandered onto. Already sitting on the launch URL means a plain reload, so the
// button refreshes in either case rather than quietly doing nothing.
async function reset(appId) {
  const app = (await getApps()).find((candidate) => candidate.id === appId);
  if (!app) return { status: "unknown-app" };

  const links = await getLinks();
  const tabId = links[appId];
  if (typeof tabId !== "number") return { status: "not-open" };

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) {
    delete links[appId];
    await setLinks(links);
    return { status: "not-open" };
  }

  if (tab.url === app.url) await chrome.tabs.reload(tabId).catch(() => {});
  else await chrome.tabs.update(tabId, { url: app.url }).catch(() => {});

  return { status: "reset" };
}

async function closeApp(appId) {
  const links = await getLinks();
  const tabId = links[appId];
  delete links[appId];
  await setLinks(links);
  if (typeof tabId === "number") {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
  return { status: "closed" };
}

// ------------------------------------------------- in-page navigation

// The content script is registered at runtime rather than declared in the
// manifest, because it only exists while the setting is on — and the host
// access it needs is optional, so declaring it would put "read all your data
// on every site" in front of people who never turn the feature on.
async function applyInPageNav(enabled) {
  if (!enabled) {
    // Open tabs tear their own overlay down when the setting changes; this
    // just stops new ones getting it.
    await chrome.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] }).catch(() => {});
    return { status: "off" };
  }

  const script = {
    id: CONTENT_SCRIPT_ID,
    js: ["content.js"],
    matches: IN_PAGE_ORIGINS,
    runAt: "document_idle",
    allFrames: false,
    persistAcrossSessions: true,
  };

  // Registering twice throws, so fall back to updating an existing one.
  await chrome.scripting
    .registerContentScripts([script])
    .catch(() => chrome.scripting.updateContentScripts([script]))
    .catch(() => {});

  // Registration only covers future loads, so reach into the tabs that are
  // already open rather than making the setting look broken until a reload.
  const tabs = await chrome.tabs.query({ url: IN_PAGE_ORIGINS });
  await Promise.all(
    tabs.map((tab) =>
      chrome.scripting
        .executeScript({ target: { tabId: tab.id }, files: ["content.js"] })
        .catch(() => {}),
    ),
  );

  return { status: "on", injected: tabs.length };
}

// Settings sync between machines but permissions do not, and the permission can
// be revoked from chrome://extensions at any time. Re-deriving the truth on
// each start keeps the registration from outliving the access it depends on.
async function reconcileInPageNav() {
  const { settings } = await chrome.storage.sync.get("settings");
  const granted = await chrome.permissions.contains({ origins: IN_PAGE_ORIGINS });
  await applyInPageNav(effectiveInPageNav(settings, granted));
}

chrome.runtime.onStartup.addListener(reconcileInPageNav);
chrome.runtime.onInstalled.addListener(reconcileInPageNav);

// Revoking host access from chrome://extensions leaves the stored intent on,
// which would otherwise show a ticked box for a feature that cannot run.
chrome.permissions.onRemoved.addListener(async () => {
  const granted = await chrome.permissions.contains({ origins: IN_PAGE_ORIGINS });
  if (granted) return;

  const { settings } = await chrome.storage.sync.get("settings");
  if (readSettings(settings).inPageNav) {
    await chrome.storage.sync.set({ settings: { ...readSettings(settings), inPageNav: false } });
  }
  await applyInPageNav(false);
});

// ---------------------------------------------------------------- upkeep

async function forgetTab(tabId) {
  const links = await getLinks();
  let changed = false;
  for (const [appId, linked] of Object.entries(links)) {
    if (linked === tabId) {
      delete links[appId];
      changed = true;
    }
  }
  if (changed) await setLinks(links);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  forgetTab(tabId);
});

// Chrome discards and restores tabs under memory pressure, which hands the
// same tab a brand new id. Without this the dock loses track of live apps.
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const links = await getLinks();
  let changed = false;
  for (const [appId, linked] of Object.entries(links)) {
    if (linked === removedTabId) {
      links[appId] = addedTabId;
      changed = true;
    }
  }
  if (changed) await setLinks(links);
});

// Navigating a linked tab out of the app's scope releases the link, so the
// next click opens a fresh instance and the dock's live indicator goes dark.
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;

  const links = await getLinks();
  const entry = Object.entries(links).find(([, linked]) => linked === tabId);
  if (!entry) return;

  const [appId] = entry;
  const app = (await getApps()).find((candidate) => candidate.id === appId);
  if (app && inScope(changeInfo.url, app)) return;

  delete links[appId];
  await setLinks(links);
});

// ---------------------------------------------------------------- wiring

// The toolbar popup and the _execute_action shortcut are both handled by
// Chrome directly, so the worker only has to answer the popup's messages.
const handlers = {
  launch: (message) => launch(message.appId),
  reset: (message) => reset(message.appId),
  close: (message) => closeApp(message.appId),
  group: (message) => group(message.windowId),
  links: () => getLinks(),
  inPageNav: (message) => applyInPageNav(message.enabled === true),
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler) return false;
  handler(message).then(sendResponse, (error) => sendResponse({ error: String(error) }));
  return true;
});
