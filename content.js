// App Dock — in-page navigation.
//
// Registered only while the "Use in page navigation" setting is on. It draws a
// small charcoal triangle in the page's top-left corner; clicking it opens the
// dock right there instead of up at the toolbar.
//
// The panel is an iframe pointing at popup.html — the very same document the
// toolbar button shows. Re-implementing the dock here would mean two UIs
// drifting apart, and the iframe runs at the extension origin so chrome.storage
// and the worker messages all work exactly as they do in the real popup.
//
// Everything sits in a closed shadow root: the page cannot style it, and page
// scripts cannot reach into it.

const HOST_ID = "app-dock-in-page-host";
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
    background: #ffffff;
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.26);
    color-scheme: light dark;
  }

  .panel.open {
    display: block;
  }

  @media (prefers-color-scheme: dark) {
    .panel { background: #18181b; border-color: rgba(250, 250, 250, 0.16); }
  }

  @media (prefers-reduced-motion: reduce) {
    .tab { transition: none; }
  }
`;

// Sub-frames would each draw their own triangle, and switching the setting on
// injects into tabs that may already be running this script.
if (window.top === window && !document.getElementById(HOST_ID)) {
  install();
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

  const panel = document.createElement("iframe");
  panel.className = "panel";
  panel.setAttribute("title", "App Dock");

  root.append(style, tab, panel);
  // Attach to <html>, not <body>. Turbo-style apps — GitHub among them —
  // swap the whole <body> out on an in-site navigation, which would take the
  // overlay with it; a content script does not run again for a navigation
  // within the same document, so nothing would put it back.
  document.documentElement.append(host);

  // And if something detaches it anyway, put it back. This only wakes for
  // changes to the direct children of <html>, which is a rare event.
  new MutationObserver(() => {
    if (!host.isConnected) document.documentElement.append(host);
  }).observe(document.documentElement, { childList: true });

  let open = false;

  function setOpen(next) {
    open = next;
    tab.classList.toggle("open", open);
    panel.classList.toggle("open", open);
    tab.setAttribute("aria-expanded", String(open));
    tab.title = open ? "Close App Dock" : "Open App Dock";

    // Load on first open rather than on every page view, so a setting that is
    // on costs an idle triangle and nothing else until it is used.
    if (open && !panel.src) {
      panel.src = chrome.runtime.getURL("popup.html?embedded=1");
    }
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
  document.addEventListener("click", (event) => {
    if (open && !event.composedPath().includes(host)) setOpen(false);
  }, true);

  document.addEventListener("keydown", (event) => {
    if (open && event.key === "Escape") setOpen(false);
  }, true);

  // The popup talks back for the things it alone knows: how tall it is, and
  // when it has done something that should dismiss the dock.
  window.addEventListener("message", (event) => {
    if (event.origin !== EXTENSION_ORIGIN) return;
    const data = event.data;
    if (!data || data.source !== "app-dock") return;

    if (data.type === "height" && Number.isFinite(data.value)) {
      panel.style.height = `${Math.min(Math.max(data.value, 40), 560)}px`;
    }
    if (data.type === "close") setOpen(false);
  });

  // Switching the setting off should clear open tabs straight away rather than
  // leaving a dead triangle behind until each one is reloaded.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.settings) return;
    if (changes.settings.newValue?.inPageNav !== true) host.remove();
  });
}
