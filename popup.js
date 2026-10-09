// App Dock — toolbar popup.
//
// The popup is a thin shell: it renders the app list, writes edits to
// chrome.storage.sync, and asks the service worker to launch. All of the
// "which tab is this app" logic lives in background.js.
//
// The same document is also what the in-page panel shows, inside an iframe on
// the page. `embedded` covers the few differences that follow from having a
// parent frame rather than being browser chrome.

import { IN_PAGE_ORIGINS, effectiveInPageNav, readSettings } from "./settings.js";

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
const settingsRow = document.getElementById("settings");
const inPageNav = document.getElementById("s-inpage");

const fields = {
  name: document.getElementById("f-name"),
  url: document.getElementById("f-url"),
  host: document.getElementById("f-host"),
  subdomains: document.getElementById("f-subdomains"),
  prefix: document.getElementById("f-prefix"),
  adopt: document.getElementById("f-adopt"),
};

const embedded = new URLSearchParams(location.search).get("embedded") === "1";

let apps = [];
let links = {};
let settings = readSettings(null);
let editing = false;
let draftId = null;
let dragId = null;
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
    if (live) {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.title = "Open — click to switch to it";
      launch.append(dot);
    }

    launch.title = live ? `Switch to ${app.name}` : `Open ${app.name}`;
    launch.addEventListener("click", () => launchApp(app.id));
    row.append(launch);

    if (editing) {
      row.append(
        iconButton("✏️", `Edit ${app.name}`, "", () => openForm(app)),
        iconButton("✕", `Remove ${app.name}`, "remove", () => removeApp(app.id)),
      );
    } else if (live) {
      row.append(
        iconButton("↻", `Reload ${app.name} at its launch URL`, "reset", () => resetApp(app.id)),
        iconButton("✕", `Close ${app.name}`, "remove", () => closeApp(app.id)),
      );
    }

    list.append(row);
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
  // Focusing a tab usually dismisses the popup; refreshing is for the case
  // where it does not, so the live dot stays accurate.
  await refresh();
}

async function resetApp(appId) {
  await chrome.runtime.sendMessage({ type: "reset", appId });
  await refresh();
}

async function closeApp(appId) {
  await chrome.runtime.sendMessage({ type: "close", appId });
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
    const result = await chrome.runtime.sendMessage({
      type: "group",
      windowId: active?.windowId,
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
  form.hidden = false;
  empty.hidden = true;
  fields.name.focus();
  fields.name.select();
}

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

  const host = fields.host.value.trim() || parsed.hostname;
  const prefix = fields.prefix.value.trim();
  const draft = {
    id: draftId ?? crypto.randomUUID(),
    name: fields.name.value.trim() || host,
    url,
    adopt: fields.adopt.checked,
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

toggleEdit.addEventListener("click", () => {
  editing = !editing;
  toggleEdit.setAttribute("aria-pressed", String(editing));
  toggleEdit.textContent = editing ? "Done" : "Edit";
  if (!editing) closeForm();
  render();
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

async function renderInPageNav() {
  const granted = await chrome.permissions.contains({ origins: IN_PAGE_ORIGINS });
  inPageNav.checked = effectiveInPageNav(settings, granted);
}

async function setInPageNav(enabled) {
  settings = { ...settings, inPageNav: enabled };
  await chrome.storage.sync.set({ settings });
  await chrome.runtime.sendMessage({ type: "inPageNav", enabled });
}

inPageNav.addEventListener("change", () => {
  if (!inPageNav.checked) {
    // Unregister first, while the permission is still held, then hand the host
    // access back so switching the feature off does not leave the extension
    // holding access to every page.
    setInPageNav(false)
      .then(() => chrome.permissions.remove({ origins: IN_PAGE_ORIGINS }))
      .then(() => showNote("In-page triangle turned off."))
      .catch(() => showNote("Could not turn that off."));
    return;
  }

  // chrome.permissions.request needs this click's user gesture, and an await
  // before the call would spend it. Hence the callback rather than a promise.
  chrome.permissions.request({ origins: IN_PAGE_ORIGINS }, (granted) => {
    if (!granted) {
      inPageNav.checked = false;
      showNote("App Dock needs access to pages to draw the triangle.");
      return;
    }
    setInPageNav(true)
      .then(() => showNote("Triangle added to the top-left of every page."))
      .catch(() => showNote("Could not turn that on."));
  });
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
  document.documentElement.classList.add("embedded");

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
