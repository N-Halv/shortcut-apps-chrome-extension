// App Dock — in-page navigation.
//
// Registered only while "Use in page navigation" or "Show shortcut bar" is on.
// The first draws a small charcoal triangle in the page's top-left corner;
// clicking it opens the dock right there instead of up at the toolbar. The
// second pins a slim bar of the apps to the top of the page, with Group and
// Edit as icon buttons at its left end; Edit drops the same dock panel down
// from under the bar. With the bar on the triangle is redundant, so it hides.
//
// The panel is an iframe pointing at popup.html — the very same document the
// toolbar button shows. Re-implementing the dock here would mean two UIs
// drifting apart, and the iframe runs at the extension origin so chrome.storage
// and the worker messages all work exactly as they do in the real popup.
//
// Everything sits in a closed shadow root: the page cannot style it, and page
// scripts cannot reach into it.

const HOST_ID = "app-dock-in-page-host";
const BAR_HEIGHT = 36;
const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL("/")).origin;

const STYLE = `
  /* The shadow tree is safe from page CSS, but the host element itself is
     not: a page rule outranks a plain :host rule. */
  :host { all: initial !important; }

  .tab {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483647;
    width: 15px;
    height: 15px;
    margin: 0;
    padding: 0;
    border: none;
    background: #3f3f46;
    /* A corner wedge rather than a floating glyph, so it hugs the corner and
       covers as little of the page as possible. */
    clip-path: polygon(0 0, 100% 0, 0 100%);
    opacity: 0.55;
    cursor: pointer;
    transition: opacity 120ms ease, width 120ms ease, height 120ms ease;
  }

  .tab:hover,
  .tab:focus-visible,
  .tab.open {
    width: 19px;
    height: 19px;
    opacity: 1;
  }

  .tab:focus-visible {
    outline: 2px solid #6366f1;
    outline-offset: 2px;
  }

  .bar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 2147483646;
    display: none;
    width: 100vw;
    height: ${BAR_HEIGHT}px;
    border: none;
    background: #f8fbf1;
    color-scheme: light dark;
  }

  .bar.show {
    display: block;
  }

  .panel {
    position: fixed;
    top: 14px;
    left: 14px;
    z-index: 2147483647;
    display: none;
    width: 320px;
    /* Replaced by the popup's own measurement a moment after it loads. Close
       to a typical dock, so the correction is not a visible jump. */
    height: 300px;
    border: 1px solid rgba(63, 63, 70, 0.28);
    border-radius: 10px;
    background: #f8fbf1;
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.26);
    color-scheme: light dark;
  }

  .panel.open {
    display: block;
  }

  /* Dropped down from the bar rather than from the corner triangle. */
  .panel.under-bar {
    top: ${BAR_HEIGHT + 4}px;
    left: 8px;
  }

  .menu {
    position: fixed;
    top: ${BAR_HEIGHT}px;
    z-index: 2147483647;
    display: none;
    min-width: 180px;
    max-width: 320px;
    max-height: 60vh;
    overflow-y: auto;
    padding: 4px;
    border: 1px solid rgba(63, 63, 70, 0.28);
    border-radius: 8px;
    background: #f8fbf1;
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.26);
    font: 13px/1.4 system-ui, -apple-system, sans-serif;
  }

  .menu.open {
    display: block;
  }

  .menu button {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: none;
    border-radius: 6px;
    background: none;
    color: #18181b;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
  }

  .menu button:hover,
  .menu button:focus-visible {
    background: rgba(63, 63, 70, 0.12);
    outline: none;
  }

  .tab.hidden {
    display: none;
  }

  @media (prefers-color-scheme: dark) {
    .panel { background: #18181b; border-color: rgba(250, 250, 250, 0.16); }
    .bar { background: #18181b; }
    .menu { background: #18181b; border-color: rgba(250, 250, 250, 0.16); }
    .menu button { color: #fafafa; }
    .menu button:hover, .menu button:focus-visible { background: rgba(250, 250, 250, 0.12); }
  }

  @media (prefers-reduced-motion: reduce) {
    .tab { transition: none; }
  }
`;

// Sub-frames would each draw their own triangle and bar, and switching a
// setting on injects into tabs that may already be running this script. The
// flag lives in this script's own isolated world, so the page cannot see it.
if (window.top === window && !globalThis.__appDockInstalled) {
  globalThis.__appDockInstalled = true;
  install();
}

// Content scripts cannot import modules, so this restates the rule from
// settings.js: only a real boolean true counts as on.
function readFlags(stored) {
  const raw = stored && typeof stored === "object" ? stored : {};
  return {
    inPageNav: raw.inPageNav === true,
    shortcutBar: raw.shortcutBar === true,
    backgroundColor: typeof raw.backgroundColor === "string" ? raw.backgroundColor.trim() : "",
  };
}

function install() {
  const host = document.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = STYLE;

  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "tab";
  tab.title = "Open App Dock";
  tab.setAttribute("aria-label", "Open App Dock");
  tab.setAttribute("aria-expanded", "false");

  // The bar is the popup document again, in its horizontal layout. Like the
  // panel it loads lazily, so a page that never shows it never pays for it.
  const bar = document.createElement("iframe");
  bar.className = "bar";
  bar.setAttribute("title", "App Dock shortcut bar");

  const panel = document.createElement("iframe");
  panel.className = "panel";
  panel.setAttribute("title", "App Dock");

  // The dropdown of an app's sub-links, drawn here because the bar's own frame
  // is only as tall as the bar.
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");

  root.append(style, tab, bar, panel, menu);

  let flags = { inPageNav: false, shortcutBar: false, backgroundColor: "" };
  let menuAppId = null;
  let wanted = false;
  let open = false;

  function attach() {
    // Attach to <html>, not <body>. Turbo-style apps — GitHub among them —
    // swap the whole <body> out on an in-site navigation, which would take the
    // overlay with it; a content script does not run again for a navigation
    // within the same document, so nothing would put it back.
    if (!host.isConnected) document.documentElement.append(host);
  }

  // And if something detaches it anyway, put it back. This only wakes for
  // changes to the direct children of <html>, which is a rare event.
  new MutationObserver(() => {
    if (wanted) attach();
  }).observe(document.documentElement, { childList: true });

  function closeMenu() {
    menuAppId = null;
    menu.classList.remove("open");
  }

  async function openMenu(appId, left) {
    if (menuAppId === appId) {
      closeMenu();
      return;
    }

    const { apps = [] } = await chrome.storage.sync.get("apps");
    const app = apps.find((candidate) => candidate.id === appId);
    if (!app?.links?.length) return;

    menu.textContent = "";
    for (const child of app.links) {
      const item = document.createElement("button");
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.textContent = child.name;
      item.title = child.url;
      item.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "openLink", appId, linkId: child.id });
        closeMenu();
      });
      menu.append(item);
    }

    menu.style.left = `${Math.max(4, Math.min(left, window.innerWidth - 200))}px`;
    menuAppId = appId;
    setOpen(false);
    menu.classList.add("open");
  }

  function setOpen(next, fromBar = false) {
    open = next;
    if (open) closeMenu();
    tab.classList.toggle("open", open);
    panel.classList.toggle("open", open);
    panel.classList.toggle("under-bar", open && fromBar);
    tab.setAttribute("aria-expanded", String(open));
    tab.title = open ? "Close App Dock" : "Open App Dock";

    if (!open) return;
    // Loaded on open rather than on every page view, so a setting that is on
    // costs an idle triangle or bar and nothing else until it is used. From
    // the bar it is always reloaded, so it starts in edit mode every time.
    if (fromBar) {
      panel.src = chrome.runtime.getURL("popup.html?embedded=1&edit=1");
    } else if (!panel.src || panel.src.includes("edit=1")) {
      panel.src = chrome.runtime.getURL("popup.html?embedded=1");
    }
  }

  // Properties set on <html> and <body> to make room for the bar. The page
  // scrolls inside <body>, not the window, so that a sticky header (top: 0)
  // sticks to the bottom edge of the bar instead of sliding under it.
  const ROOM_PROPS = ["margin-top", "height", "overflow", "position", "inset"];

  function clearRoom() {
    for (const el of [document.documentElement, document.body]) {
      if (!el) continue;
      for (const name of ROOM_PROPS) el.style.removeProperty(name);
    }
  }

  function makeRoom() {
    const root = document.documentElement.style;
    root.setProperty("margin-top", `${BAR_HEIGHT}px`, "important");
    root.setProperty("height", `calc(100% - ${BAR_HEIGHT}px)`, "important");
    root.setProperty("overflow", "hidden", "important");
    root.setProperty("position", "relative", "important");
    const body = document.body;
    if (!body) return;
    body.style.setProperty("position", "absolute", "important");
    body.style.setProperty("inset", "0", "important");
    body.style.setProperty("overflow", "auto", "important");
  }

  function apply(next) {
    flags = next;
    // An unparseable color is dropped by the browser, leaving the default.
    menu.style.backgroundColor = flags.backgroundColor;
    wanted = flags.inPageNav || flags.shortcutBar;

    if (!wanted) {
      clearRoom();
      setOpen(false);
      closeMenu();
      host.remove();
      return;
    }

    if (flags.shortcutBar && !bar.src) {
      bar.src = chrome.runtime.getURL("popup.html?bar=1");
    }
    bar.classList.toggle("show", flags.shortcutBar);
    // Make room rather than covering the page. Set through the CSSOM, which a
    // page's content security policy does not restrict the way it does a
    // <style> element.
    if (flags.shortcutBar) {
      makeRoom();
    } else {
      clearRoom();
    }
    // The bar carries its own Edit button, which makes the triangle redundant.
    tab.classList.toggle("hidden", flags.shortcutBar);
    if (!flags.shortcutBar && open && panel.classList.contains("under-bar")) setOpen(false);
    attach();
  }

  tab.addEventListener("click", () => {
    setOpen(!open);
  });

  // Clicks inside the panel never reach the page — they land in the iframe — so
  // any click out here means "elsewhere". The triangle is the exception, and it
  // has to be spotted here rather than stopped at the button: this listener
  // captures, so it runs first and would otherwise close the panel a moment
  // before the button's own handler reopened it. A closed shadow root hides the
  // button from composedPath, but the host element it is in still shows up.
  // The bar is an iframe too, so its clicks never get here; it asks for the
  // panel by message instead.
  document.addEventListener("click", (event) => {
    if (event.composedPath().includes(host)) return;
    if (open) setOpen(false);
    closeMenu();
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (open) setOpen(false);
    closeMenu();
  }, true);

  // The popup talks back for the things it alone knows: how tall it is, when
  // it has done something that should dismiss the dock, and — from the bar —
  // that Edit was pressed.
  window.addEventListener("message", (event) => {
    if (event.origin !== EXTENSION_ORIGIN) return;
    const data = event.data;
    if (!data || data.source !== "app-dock") return;

    if (data.type === "height" && Number.isFinite(data.value)) {
      panel.style.height = `${Math.min(Math.max(data.value, 40), 560)}px`;
    }
    if (data.type === "close") {
      setOpen(false);
      closeMenu();
    }
    if (data.type === "submenu" && typeof data.appId === "string" && Number.isFinite(data.left)) {
      openMenu(data.appId, data.left);
    }
    if (data.type === "edit") {
      closeMenu();
      setOpen(!(open && panel.classList.contains("under-bar")), true);
    }
  });

  // Settings can change from any tab: switching a feature off clears it from
  // open pages straight away rather than leaving it until each is reloaded,
  // and switching one on reaches pages that already have this script.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.settings) return;
    apply(readFlags(changes.settings.newValue));
  });

  chrome.storage.sync.get("settings").then(({ settings }) => apply(readFlags(settings)));
}
