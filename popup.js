// App Dock — toolbar popup.
//
// The popup is a thin shell: it renders the app list, writes edits to
// chrome.storage.sync, and asks the service worker to launch. All of the
// "which tab is this app" logic lives in background.js.
//
// The same document is also what the in-page panel shows, inside an iframe on
// the page. `embedded` covers the few differences that follow from having a
// parent frame rather than being browser chrome.

import {
  IN_PAGE_ORIGINS,
  effectiveInPageNav,
  effectiveShortcutBar,
  readSettings,
} from "./settings.js";

const list = document.getElementById("list");
const empty = document.getElementById("empty");
const footer = document.getElementById("footer");
const form = document.getElementById("form");
const note = document.getElementById("note");
const groupButton = document.getElementById("group");
const toggleEdit = document.getElementById("toggle-edit");
const addNew = document.getElementById("add-new");
const addCurrent = document.getElementById("add-current");
const cancel = document.getElementById("cancel");
const sublinkList = document.getElementById("f-links");
const addSublink = document.getElementById("add-sublink");
const settingsRow = document.getElementById("settings");
const inPageNav = document.getElementById("s-inpage");
const shortcutBar = document.getElementById("s-bar");
const backgroundColor = document.getElementById("s-bg");

const fields = {
  name: document.getElementById("f-name"),
  url: document.getElementById("f-url"),
  host: document.getElementById("f-host"),
  subdomains: document.getElementById("f-subdomains"),
  prefix: document.getElementById("f-prefix"),
  adopt: document.getElementById("f-adopt"),
};

const params = new URLSearchParams(location.search);
// `bar` is the shortcut bar's own strip; `embedded` is the dropdown panel. Both
// live in an iframe, but only the panel is sized to its content.
const bar = params.get("bar") === "1";
const embedded = bar || params.get("embedded") === "1";

let apps = [];
let links = {};
let settings = readSettings(null);
// The bar's Edit button opens this document as a dropdown already in edit mode.
let editing = !bar && params.get("edit") === "1";
let draftId = null;
let dragId = null;
// Apps whose sub-links are unfolded in the list. Not persisted: it is a view
// state, and a dock that reopens folded is the tidier default.
const expanded = new Set();

const CHEVRON =
  '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
let noteTimer = null;

// ---------------------------------------------------------------- storage

async function loadApps() {
  const { apps: stored = [] } = await chrome.storage.sync.get("apps");
  apps = stored;
}

async function saveApps() {
  await chrome.storage.sync.set({ apps });
}

async function loadSettings() {
  const { settings: stored } = await chrome.storage.sync.get("settings");
  settings = readSettings(stored);
}

async function loadLinks() {
  links = (await chrome.runtime.sendMessage({ type: "links" })) ?? {};
}

function faviconURL(pageURL) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", pageURL);
  url.searchParams.set("size", "32");
  return url.toString();
}

function safeURL(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- render

function render() {
  list.textContent = "";

  for (const app of apps) {
    const row = document.createElement("li");
    row.className = "row";
    row.dataset.id = app.id;

    if (editing) {
      row.draggable = true;
      const handle = document.createElement("span");
      handle.className = "handle";
      handle.textContent = "⠿";
      handle.title = "Drag to reorder";
      row.append(handle);
    }

    const launch = document.createElement("button");
    launch.className = "launch";
    launch.type = "button";

    const icon = document.createElement("img");
    icon.src = faviconURL(app.url);
    icon.alt = "";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = app.name;

    launch.append(icon, name);

    const live = typeof links[app.id] === "number";

    launch.title = live ? `Switch to ${app.name}` : `Open ${app.name}`;
    launch.addEventListener("click", () => launchApp(app.id));
    row.append(launch);

    const children = app.links ?? [];
    let chevron = null;
    if (children.length > 0) {
      chevron = iconButton("▾", `Sub-links for ${app.name}`, "chevron", () => {
        if (bar) {
          // The bar is only 36px tall, so the page draws the menu for it.
          postToPanel({
            type: "submenu",
            appId: app.id,
            left: Math.round(chevron.getBoundingClientRect().left),
          });
          return;
        }
        if (!expanded.delete(app.id)) expanded.add(app.id);
        render();
      });
      // A drawn chevron rather than the ▾ character, whose position in the line
      // varies with the font and sat below the text's middle.
      chevron.innerHTML = CHEVRON;
      chevron.setAttribute("aria-haspopup", "true");
      chevron.setAttribute("aria-expanded", String(expanded.has(app.id)));
      row.append(chevron);
    }

    if (editing) {
      row.append(
        iconButton("✏️", `Edit ${app.name}`, "", () => openForm(app)),
        iconButton("✕", `Remove ${app.name}`, "remove", () => removeApp(app.id)),
      );
    } else if (live) {
      row.append(
        iconButton("↻", `Reload ${app.name} at its launch URL`, "reset", () => resetApp(app.id)),
      );
    }

    list.append(row);

    if (!bar && expanded.has(app.id)) {
      for (const child of children) {
        const item = document.createElement("li");
        item.className = "sub";
        const go = document.createElement("button");
        go.type = "button";
        go.className = "launch";
        go.textContent = child.name;
        go.title = child.url;
        go.addEventListener("click", () => openLink(app.id, child.id));
        item.append(go);
        list.append(item);
      }
    }
  }

  footer.hidden = !editing;
  settingsRow.hidden = !editing;
  renderEmpty();
}

// Adding is only reachable from edit mode, so the empty state has to point
// there rather than at buttons that are not on screen.
function renderEmpty() {
  empty.hidden = apps.length > 0 || !form.hidden;
  empty.textContent = editing
    ? "No apps yet. Use “Add current tab” below."
    : "No apps yet. Click “Edit” to add one.";
}

function iconButton(glyph, title, extra, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon ${extra}`.trim();
  button.textContent = glyph;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.addEventListener("click", onClick);
  return button;
}

function showNote(message) {
  note.textContent = message;
  note.hidden = false;
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    note.hidden = true;
  }, 4000);
}

function flashRow(appId) {
  const row = list.querySelector(`[data-id="${CSS.escape(appId)}"]`);
  if (!row) return;
  row.classList.add("flash");
  row.scrollIntoView({ block: "nearest" });
}

// ---------------------------------------------------------------- actions

async function launchApp(appId) {
  await chrome.runtime.sendMessage({ type: "launch", appId });
  postToPanel({ type: "close" });
  postToPanel({ type: "launched" });
  // Focusing a tab usually dismisses the popup; refreshing is for the case
  // where it does not, so the reload buttons stay accurate.
  await refresh();
}

async function openLink(appId, linkId) {
  await chrome.runtime.sendMessage({ type: "openLink", appId, linkId });
  postToPanel({ type: "close" });
  postToPanel({ type: "launched" });
  await refresh();
}

async function resetApp(appId) {
  await chrome.runtime.sendMessage({ type: "reset", appId });
  postToPanel({ type: "close" });
  postToPanel({ type: "launched" });
  await refresh();
}

async function removeApp(appId) {
  apps = apps.filter((app) => app.id !== appId);
  await saveApps();
  if (draftId === appId) closeForm();
  render();
}

async function refresh() {
  await Promise.all([loadApps(), loadLinks(), loadSettings()]);
  await renderInPageNav();
  render();
}

// ---------------------------------------------------------------- adding

// "Add current tab" has everything it needs already, so it saves straight
// away. Tune the scope later with Edit if the defaults are not right.
addCurrent.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const parsed = tab?.url ? safeURL(tab.url) : null;

  if (!parsed) {
    showNote("That tab is not a web page. Use “Add new” to enter a URL.");
    return;
  }

  const duplicate = apps.find(
    (app) => (app.scope?.host ?? "").toLowerCase() === parsed.hostname.toLowerCase(),
  );
  if (duplicate) {
    showNote(`“${duplicate.name}” already covers ${parsed.hostname}.`);
    flashRow(duplicate.id);
    return;
  }

  apps.push({
    id: crypto.randomUUID(),
    name: tab.title?.trim() || parsed.hostname,
    url: tab.url,
    adopt: true,
    scope: { host: parsed.hostname, matchSubdomains: false, pathPrefix: "" },
  });
  await saveApps();
  closeForm();
  render();
  showNote(`Added ${parsed.hostname}.`);
});

// ---------------------------------------------------------------- grouping

groupButton.addEventListener("click", async () => {
  groupButton.disabled = true;
  try {
    // Everything gathers into the window this popup was opened from.
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    // In the bar there is no popup window to ask about; the worker uses the
    // window of the tab the bar is sitting in.
    const result = await chrome.runtime.sendMessage({
      type: "group",
      windowId: bar ? undefined : active?.windowId,
    });
    await refresh();

    const moved = result?.moved ?? 0;
    if (!moved) {
      showNote("No app tabs are open to group.");
    } else {
      const tabs = `${moved} tab${moved === 1 ? "" : "s"}`;
      const pulled = result.gathered ? `, ${result.gathered} from other windows` : "";
      showNote(`Grouped ${tabs}${pulled}.`);
    }
  } finally {
    groupButton.disabled = false;
  }
});

addNew.addEventListener("click", () => {
  if (!form.hidden && draftId === null) closeForm();
  else openForm(null);
});

// ---------------------------------------------------------------- form

function openForm(app) {
  draftId = app?.id ?? null;
  fields.name.value = app?.name ?? "";
  fields.url.value = app?.url ?? "";
  fields.host.value = app?.scope?.host ?? "";
  fields.subdomains.checked = Boolean(app?.scope?.matchSubdomains);
  fields.prefix.value = app?.scope?.pathPrefix ?? "";
  fields.adopt.checked = app ? app.adopt !== false : true;
  sublinkList.textContent = "";
  for (const child of app?.links ?? []) addSublinkRow(child);
  form.hidden = false;
  empty.hidden = true;
  fields.name.focus();
  fields.name.select();
}

function addSublinkRow(child = {}) {
  const row = document.createElement("div");
  row.className = "sublink";
  row.dataset.id = child.id ?? crypto.randomUUID();

  const name = document.createElement("input");
  name.type = "text";
  name.placeholder = "Name";
  name.value = child.name ?? "";
  name.setAttribute("aria-label", "Sub-link name");
  name.autocomplete = "off";

  const url = document.createElement("input");
  url.type = "url";
  url.placeholder = "https://…";
  url.value = child.url ?? "";
  url.setAttribute("aria-label", "Sub-link URL");
  url.autocomplete = "off";

  const remove = iconButton("✕", "Remove sub-link", "remove", () => row.remove());
  row.append(name, url, remove);
  sublinkList.append(row);
  if (!child.url) name.focus();
}

addSublink.addEventListener("click", () => addSublinkRow());

function closeForm() {
  form.hidden = true;
  draftId = null;
  renderEmpty();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const url = fields.url.value.trim();
  const parsed = safeURL(url);
  if (!parsed) {
    showNote("Enter a full http:// or https:// URL.");
    fields.url.focus();
    return;
  }

  // Rows left completely blank are just unused; anything half-filled has to be
  // a real link, or the dropdown would show an entry that goes nowhere.
  const sublinks = [];
  for (const row of sublinkList.children) {
    const [nameInput, urlInput] = row.querySelectorAll("input");
    const childURL = urlInput.value.trim();
    if (!childURL && !nameInput.value.trim()) continue;

    const childParsed = safeURL(childURL);
    if (!childParsed) {
      showNote("Each sub-link needs a full http:// or https:// URL.");
      urlInput.focus();
      return;
    }
    sublinks.push({
      id: row.dataset.id,
      name: nameInput.value.trim() || childParsed.hostname + childParsed.pathname,
      url: childURL,
    });
  }

  const host = fields.host.value.trim() || parsed.hostname;
  const prefix = fields.prefix.value.trim();
  const draft = {
    id: draftId ?? crypto.randomUUID(),
    name: fields.name.value.trim() || host,
    url,
    adopt: fields.adopt.checked,
    links: sublinks,
    scope: {
      host,
      matchSubdomains: fields.subdomains.checked,
      pathPrefix: prefix && !prefix.startsWith("/") ? `/${prefix}` : prefix,
    },
  };

  const index = apps.findIndex((app) => app.id === draft.id);
  if (index === -1) apps.push(draft);
  else apps[index] = draft;

  await saveApps();
  closeForm();
  render();
});

cancel.addEventListener("click", closeForm);

// ---------------------------------------------------------------- edit mode

function renderEditButton() {
  toggleEdit.setAttribute("aria-pressed", String(editing));
  toggleEdit.querySelector(".label").textContent = editing ? "Done" : "Edit";
  toggleEdit.title = editing ? "Done" : "Edit";
}

toggleEdit.addEventListener("click", () => {
  // The bar has no room for the editor, so it asks the page to drop down the
  // dock panel instead.
  if (bar) {
    postToPanel({ type: "edit" });
    return;
  }

  editing = !editing;
  // A dropdown opened from the bar exists only to edit, so finishing closes it.
  if (embedded && !editing) postToPanel({ type: "close" });
  renderEditButton();
  if (!editing) closeForm();
  render();
});

renderEditButton();

// The host page owns the bar's frame, so it does the sliding.
document.getElementById("collapse").addEventListener("click", () => {
  postToPanel({ type: "collapse" });
});

list.addEventListener("dragstart", (event) => {
  const row = event.target.closest(".row");
  if (!row) return;
  dragId = row.dataset.id;
  row.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
});

list.addEventListener("dragover", (event) => {
  const row = event.target.closest(".row");
  if (!row || !dragId || row.dataset.id === dragId) return;
  event.preventDefault();
  for (const other of list.children) other.classList.remove("drop-target");
  row.classList.add("drop-target");
});

list.addEventListener("drop", async (event) => {
  const row = event.target.closest(".row");
  if (!row || !dragId) return;
  event.preventDefault();

  const from = apps.findIndex((app) => app.id === dragId);
  const to = apps.findIndex((app) => app.id === row.dataset.id);
  if (from === -1 || to === -1 || from === to) return;

  const [moved] = apps.splice(from, 1);
  apps.splice(to, 0, moved);
  await saveApps();
  dragId = null;
  render();
});

list.addEventListener("dragend", () => {
  dragId = null;
  for (const row of list.children) row.classList.remove("dragging", "drop-target");
});

// ------------------------------------------------- in-page navigation

// Whatever was typed goes straight into `background-color`. The browser drops
// a value it cannot parse, which leaves the theme's own background in place.
function applyBackground() {
  document.body.style.backgroundColor = settings.backgroundColor;
  if (document.activeElement !== backgroundColor) {
    backgroundColor.value = settings.backgroundColor;
  }
}

backgroundColor.addEventListener("change", async () => {
  const value = backgroundColor.value.trim();
  const valid = value === "" || CSS.supports("background-color", value);
  if (!valid) {
    showNote(`“${value}” is not a CSS color.`);
    return;
  }
  settings = { ...settings, backgroundColor: value };
  await chrome.storage.sync.set({ settings });
  applyBackground();
});

async function renderInPageNav() {
  applyBackground();
  const granted = await chrome.permissions.contains({ origins: IN_PAGE_ORIGINS });
  inPageNav.checked = effectiveInPageNav(settings, granted);
  shortcutBar.checked = effectiveShortcutBar(settings, granted);
}

// The triangle and the bar share one content script and one permission, so the
// script stays registered while either is on, and the host access is handed
// back only once both are off.
async function setFlag(key, enabled) {
  settings = { ...settings, [key]: enabled };
  await chrome.storage.sync.set({ settings });
  await chrome.runtime.sendMessage({
    type: "inPageNav",
    enabled: settings.inPageNav || settings.shortcutBar,
  });
}

function bindFlag(checkbox, key, text) {
  checkbox.addEventListener("change", () => {
    if (!checkbox.checked) {
      // Update first, while the permission is still held, then release it if
      // nothing else needs it.
      setFlag(key, false)
        .then(() =>
          settings.inPageNav || settings.shortcutBar
            ? undefined
            : chrome.permissions.remove({ origins: IN_PAGE_ORIGINS }),
        )
        .then(() => showNote(text.off))
        .catch(() => showNote("Could not turn that off."));
      return;
    }

    // chrome.permissions.request needs this click's user gesture, and an await
    // before the call would spend it. Hence the callback rather than a promise.
    chrome.permissions.request({ origins: IN_PAGE_ORIGINS }, (granted) => {
      if (!granted) {
        checkbox.checked = false;
        showNote(text.denied);
        return;
      }
      setFlag(key, true)
        .then(() => showNote(text.on))
        .catch(() => showNote("Could not turn that on."));
    });
  });
}

bindFlag(inPageNav, "inPageNav", {
  on: "Triangle added to the top-left of every page.",
  off: "In-page triangle turned off.",
  denied: "App Dock needs access to pages to draw the triangle.",
});

bindFlag(shortcutBar, "shortcutBar", {
  on: "Shortcut bar added to the top of every page.",
  off: "Shortcut bar turned off.",
  denied: "App Dock needs access to pages to draw the shortcut bar.",
});

// ---------------------------------------------------------------- embedded

// Inside the panel this document is an iframe, so two things browser chrome
// would do for free have to be asked for: being sized to its content, and
// being dismissed. The parent is an arbitrary page, so the target origin has
// to be "*" — only a height and a close signal ever go out.
function postToPanel(message) {
  if (embedded) parent.postMessage({ source: "app-dock", ...message }, "*");
}

if (embedded) {
  document.documentElement.classList.add(bar ? "bar" : "embedded");
}

// The bar is a fixed height set by the page, so only the dropdown reports one.
if (embedded && !bar) {
  const reportHeight = () => {
    postToPanel({ type: "height", value: Math.ceil(document.body.getBoundingClientRect().height) });
  };
  new ResizeObserver(reportHeight).observe(document.body);
  reportHeight();

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") postToPanel({ type: "close" });
  });
}

// ---------------------------------------------------------------- sync

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.apps) {
    apps = changes.apps.newValue ?? [];
    render();
  }
  if (area === "sync" && changes.settings) {
    settings = readSettings(changes.settings.newValue);
    renderInPageNav();
  }
  if (area === "session" && changes.links) {
    links = changes.links.newValue ?? {};
    render();
  }
});

refresh();
