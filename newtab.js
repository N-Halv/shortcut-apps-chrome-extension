// App Dock — new tab page.
//
// A launcher grid over the same apps the dock holds, with a search box. It only
// renders and asks the worker to act; launching, grouping and sub-links all go
// through background.js exactly as they do from the popup. Editing is the
// popup's own editor, dropped down in an iframe, so there is one editor.

import { readSettings } from "./settings.js";

const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const note = document.getElementById("note");
const search = document.getElementById("search");
const query = document.getElementById("q");
const groupButton = document.getElementById("group");
const editButton = document.getElementById("edit");
const panel = document.getElementById("panel");
const bar = document.getElementById("bar");
const tools = document.getElementById("tools");
const barMenu = document.getElementById("menu");

// A drawn chevron rather than a ▾ character, which sits below the text's middle.
const CHEVRON =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let apps = [];
let openMenuId = null;
let barMenuAppId = null;
let panelFromBar = false;
let collapseTimer = null;
let noteTimer = null;

function faviconURL(pageURL) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageURL);
  url.searchParams.set("size", "64");
  return url.toString();
}

function showNote(message) {
  note.textContent = message;
  note.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    note.hidden = true;
  }, 4000);
}

// ---------------------------------------------------------------- render

function render() {
  grid.textContent = "";
  empty.hidden = apps.length > 0;

  for (const app of apps) {
    const tile = document.createElement("li");
    tile.className = "tile";

    const launch = document.createElement("button");
    launch.type = "button";
    launch.className = "launch";
    launch.title = app.name;

    const icon = document.createElement("img");
    icon.src = faviconURL(app.url);
    icon.alt = "";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = app.name;
    launch.append(icon, name);
    launch.addEventListener("click", () => go({ type: "launch", appId: app.id }));
    tile.append(launch);

    if (app.links?.length) {
      const open = openMenuId === app.id;
      const more = document.createElement("button");
      more.type = "button";
      more.className = "more";
      more.innerHTML = CHEVRON;
      more.title = `Sub-links for ${app.name}`;
      more.setAttribute("aria-label", more.title);
      more.setAttribute("aria-haspopup", "true");
      more.setAttribute("aria-expanded", String(open));
      more.addEventListener("click", (event) => {
        event.stopPropagation();
        openMenuId = open ? null : app.id;
        render();
      });
      tile.append(more);

      if (open) {
        const menu = document.createElement("div");
        menu.className = "children";
        menu.setAttribute("role", "menu");
        for (const child of app.links) {
          const item = document.createElement("button");
          item.type = "button";
          item.setAttribute("role", "menuitem");
          item.textContent = child.name;
          item.title = child.url;
          item.addEventListener("click", () =>
            go({ type: "openLink", appId: app.id, linkId: child.id }),
          );
          menu.append(item);
        }
        tile.append(menu);
      }
    }

    grid.append(tile);
  }
}

// Launching from here leaves this tab behind: either a new tab was opened for
// the app, or an existing one was switched to. Either way a spare new tab page
// is just clutter, so it goes.
async function go(message) {
  await chrome.runtime.sendMessage(message);
  await closeThisTab();
}

async function closeThisTab() {
  const current = await chrome.tabs.getCurrent();
  if (current?.id !== undefined) chrome.tabs.remove(current.id).catch(() => {});
}

// ---------------------------------------------------------------- actions

groupButton.addEventListener("click", async () => {
  groupButton.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "group" });
    const moved = result?.moved ?? 0;
    showNote(
      moved
        ? `Grouped ${moved} tab${moved === 1 ? "" : "s"}.`
        : "No app tabs are open to group.",
    );
  } finally {
    groupButton.disabled = false;
  }
});

function setEditing(on, fromBar = false) {
  panelFromBar = on && fromBar;
  panel.hidden = !on;
  editButton.setAttribute("aria-expanded", String(on));
  if (on) closeBarMenu();
  // Fresh each time, so the editor always opens on the list, not a stale form.
  if (on) panel.src = chrome.runtime.getURL("popup.html?embedded=1&edit=1");
}

editButton.addEventListener("click", (event) => {
  event.stopPropagation();
  setEditing(panel.hidden);
});

// The editor reports its height and asks to be dismissed, same as in a page.
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.source !== "app-dock") return;
  if (data.type === "height" && Number.isFinite(data.value)) {
    panel.style.height = `${Math.min(Math.max(data.value, 40), window.innerHeight - 70)}px`;
  }
  if (data.type === "close") {
    setEditing(false);
    closeBarMenu();
  }
  // Something was launched from the bar or the editor, which leaves this new
  // tab page as clutter, same as launching from the grid.
  if (data.type === "launched") closeThisTab();
  if (data.type === "edit") {
    closeBarMenu();
    setEditing(!(!panel.hidden && panelFromBar), true);
  }
  if (data.type === "submenu" && typeof data.appId === "string" && Number.isFinite(data.left)) {
    toggleBarMenu(data.appId, data.left);
  }
  if (data.type === "collapse") collapseBar();
});

// ------------------------------------------------------------- shortcut bar

function closeBarMenu() {
  barMenuAppId = null;
  barMenu.hidden = true;
}

function toggleBarMenu(appId, left) {
  if (barMenuAppId === appId) {
    closeBarMenu();
    return;
  }
  const app = apps.find((candidate) => candidate.id === appId);
  if (!app?.links?.length) return;

  barMenu.textContent = "";
  for (const child of app.links) {
    const item = document.createElement("button");
    item.type = "button";
    item.setAttribute("role", "menuitem");
    item.textContent = child.name;
    item.title = child.url;
    item.addEventListener("click", () => go({ type: "openLink", appId, linkId: child.id }));
    barMenu.append(item);
  }
  barMenu.style.left = `${Math.max(4, Math.min(left, window.innerWidth - 200))}px`;
  barMenuAppId = appId;
  setEditing(false);
  barMenu.hidden = false;
}

// Same as the in-page bar: up and out of view for three seconds, then back.
function collapseBar() {
  closeBarMenu();
  if (panelFromBar) setEditing(false);
  bar.classList.add("collapsed");
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => bar.classList.remove("collapsed"), 3000);
}

// Mirrors the in-page bar: shown when "Show shortcut bar" is on. Unlike pages,
// this one needs no host permission, so only the stored setting matters.
function applyBar(settings) {
  const on = readSettings(settings).shortcutBar;
  if (on && !bar.src) bar.src = chrome.runtime.getURL("popup.html?bar=1");
  bar.hidden = !on;
  tools.hidden = on;
  document.body.classList.toggle("has-bar", on);
  if (!on) {
    closeBarMenu();
    if (panelFromBar) setEditing(false);
  }
}

document.addEventListener("click", () => {
  closeBarMenu();
  if (openMenuId !== null) {
    openMenuId = null;
    render();
  }
  if (!panel.hidden) setEditing(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeBarMenu();
  openMenuId = null;
  render();
  setEditing(false);
});

// ---------------------------------------------------------------- search

// Anything URL-shaped is visited; everything else goes to the default search
// engine, which is what the omnibox would do.
search.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = query.value.trim();
  if (!text) return;

  const direct = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : /^[^\s/]+\.[a-z]{2,}(\/\S*)?$/i.test(text)
      ? `https://${text}`
      : null;

  if (direct) location.href = direct;
  else chrome.search.query({ text, disposition: "CURRENT_TAB" });
});

// ---------------------------------------------------------------- state

function applyBackground(settings) {
  document.body.style.backgroundColor = readSettings(settings).backgroundColor;
  applyBar(settings);
}

async function load() {
  const stored = await chrome.storage.sync.get(["apps", "settings"]);
  apps = stored.apps ?? [];
  applyBackground(stored.settings);
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.apps) {
    apps = changes.apps.newValue ?? [];
    render();
  }
  if (changes.settings) applyBackground(changes.settings.newValue);
});

query.focus();
load();
