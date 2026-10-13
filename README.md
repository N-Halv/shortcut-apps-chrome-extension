# App Dock

A Chrome extension that gives you a toolbar dock of bookmarks which behave like
applications: the first click opens a tab, every click after that switches to
the tab you already have open.

## Install

1. Visit `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick this directory.
4. Pin the extension (puzzle-piece icon → pin **App Dock**) so it stays visible.
5. Click the icon, or press <kbd>⌘⇧D</kbd>, to open the dock.

## Using it

Day to day the popup is just a launcher:

- **Launch** — click a row. If that app already has a live tab the click
  switches to it (focusing its window if it is in another one); otherwise it
  opens one.
- **Reload** — the ↻ on a live row (the sign that the app is open) sends that tab back to the app's launch URL and switches to it,
  discarding whatever route it wandered onto. If it is already on the launch URL
  this is a plain reload, so the button always does something.
- **Group** — gathers every open app tab into the current window, along the left
  of the tab strip, in the order the apps appear in the list. See below.

Everything that changes the list lives behind **Edit**, which reveals the
reorder handles, the per-row buttons, and the two add buttons in the footer:

- **Add current tab** — saves the tab you are on immediately, taking its name and
  host as the defaults. No form.
- **Add new** — opens the form, for an app you are not currently looking at or
  one that needs a non-default scope.
- **Per row** — the pencil opens the form, the ✕ removes the app, and the ⠿
  handle drags it to a new position.
- **Settings** — a collapsed section at the bottom holding **Use in page
  navigation**, **Show shortcut bar** (see below) and **Background color** for the
  bar and the dock. The color is any CSS color (`#f8fbf1`, `rebeccapurple`,
  `rgb(…)`) and is used as-is for `background-color`; empty restores the default, `#f8fbf1` (dark mode keeps its dark background).
  Text colors are not changed, so pick something that stays readable.

Apps are stored in `chrome.storage.sync`, so they follow your Chrome profile to
other machines.

## Use in page navigation

Reaching for the toolbar is a long way to move the mouse just to switch apps, so
this setting puts the dock within a few pixels of wherever the pointer already
is. Tick it in **Edit** and every page grows a small charcoal triangle in its
top-left corner; click the triangle and the dock opens right there. Click
anywhere else, press <kbd>Esc</kbd>, or launch an app to dismiss it.

It is the *same* dock, not a second copy of it: the panel is an iframe showing
`popup.html`, the very document the toolbar button opens. Anything that is true
of the popup — the reload buttons, Group, Edit, the form — is true in the panel,
because it is the same code with the same storage behind it.

**It asks for permission when you switch it on.** Drawing into pages needs
access to those pages, which the rest of the dock does not want and never asks
for. So the host permission is declared `optional` and requested at the moment
you tick the box: leave the setting alone and App Dock still installs with
nothing but storage and tabs. Unticking it hands the access back, and revoking
it yourself from `chrome://extensions` switches the setting off to match.

The content script is registered at runtime for the same reason — it exists only
while the setting is on. Switching it on also injects into the tabs you already
have open, so you do not have to reload anything to see the triangle, and
switching it off removes it from them just as promptly.

Two things to know: the triangle only appears on `http(s)` pages, because no
extension may draw on `chrome://` pages or the Web Store; and the panel is a
frame, so a site with a strict enough `frame-src` policy can refuse it.

## Sub-links

An app can have **sub-links**: named URLs that live underneath it, such as
individual projects under Linear. Add them in the app's edit form, under
*Sub-links under this app* (name and URL each; **Add sub-link** for more).

An app with sub-links shows a small ▾ next to its name. In the dock it unfolds
the children inline under the app; in the shortcut bar it drops a menu down from
the arrow. Picking one sends the app's tab there — or opens a new tab at that URL
if the app is not open — and the app stays linked to that tab, so clicking the
app itself afterwards switches to it as usual.

Keep sub-link URLs inside the app's scope (the host it counts as the same app
on). If one leaves it, the tab stops counting as that app once it lands there.

## New tab page

App Dock replaces Chrome's new tab page with a launcher: a search box over a grid
of your apps, with Group and Edit as icon buttons in the top-right corner. Click
an app to open or switch to it (the spare new tab is closed behind you); the ▾ on
a tile drops its sub-links. Edit drops the usual editor down from the corner.

The search box visits anything that looks like a URL and otherwise searches with
your default search engine (the `search` permission, which Chrome does not warn
about). It uses your background color setting.

If **Show shortcut bar** is on, the new tab page draws the bar across the top too,
where you would expect bookmarks to be, and moves Group and Edit up into it. Chrome
does not let extensions inject into its own new tab page, so this is the page
itself rather than the in-page bar; it behaves the same (Edit drops the editor
down from under it, ▾ drops sub-links) and needs only the setting, not the page
permission. Launching from it closes the spare new tab, as the grid does.

This is declared in the manifest (`chrome_url_overrides`), so it is always on once
the extension is loaded — there is no setting to switch it off. Chrome allows one
extension to replace the new tab page; remove the override from `manifest.json` to
get the default page back.

## Shortcut bar

Tick **Show shortcut bar** in **Edit** for a Chrome-style bookmarks bar pinned
to the top of every page: your apps laid out horizontally with the same favicon,
name, and Group and Edit as icon buttons at the far left. An app that is running
also shows its ↻ reload button.

**Edit** drops the normal dock down from under the bar, already in edit mode, so
reordering, adding and removing work exactly as in the popup. **Done** (or
<kbd>Esc</kbd>, or a click elsewhere) closes it. **Group** gathers app tabs into
the window the bar is in.

The bar is `position: fixed`, so it stays put while the page scrolls underneath,
and the page is shifted down 36px (a top margin on `<html>`) so nothing is
covered. Elements a site pins to the top of the viewport, such as a sticky
header, ignore that margin and will sit beneath the bar. It shares the permission and the content script
with the triangle, and replaces the triangle while it is on.

## How "same app" is decided

The problem with matching on the bookmark's exact URL is that you navigate: open
Gmail at `/mail/u/0/`, click into a thread, and the URL no longer matches. So an
app tracks a **tab**, not a URL.

Each app records the tab id it launched. On the next click:

- the recorded tab still exists **and** its current URL is inside the app's scope
  → switch to it;
- otherwise → open a fresh tab and record that one.

Scope defaults to the **host**, which is usually what you want —
`mail.google.com` and `docs.google.com` stay separate apps, while any route
within Gmail counts as Gmail. Two options adjust it:

- **Include subdomains** — `github.com` then also covers `gist.github.com`.
- **Path starts with** — pin an app to one workspace, e.g. host `www.notion.so`
  with prefix `/my-team/`.

**Adopt a matching tab that is already open** (on by default) means that if you
reached the site some other way, the dock claims that tab on first click instead
of opening a duplicate.

The mapping lives in `chrome.storage.session`, because tab ids are only
meaningful for the life of the browser session. Three listeners keep it honest:

| Event | Why it matters |
| --- | --- |
| `tabs.onRemoved` | You closed the tab, so the app is no longer live. |
| `tabs.onReplaced` | Chrome discarded and restored the tab, handing it a new id. |
| `tabs.onUpdated` | You navigated out of scope, so release the link. |

## Group

**Group** collects your apps into one window and lines them up on the left in
list order: with Gmail, Linear, and GitHub in the dock, the first three tabs
become Gmail, Linear, GitHub. Everything else in that window keeps its relative
order and shifts right.

The destination is **the window the popup was opened from**, so grouping happens
wherever you are working. App tabs sitting in other windows are pulled across.
If one of those windows is left with no tabs at all, Chrome closes it — the usual
behaviour when a window's last tab leaves.

It runs in two passes, because the strip changes underneath it: first the strays
move in and land at the end, then the whole run is re-queried and ordered. The
re-query matters for more than position — a tab's pinned flag has to be read
*after* it arrives.

Two things it deliberately does not do:

- **It never opens a tab.** Only apps that are already running get moved, so
  Group is a tidy-up rather than a "start my day" button.
- **It never disturbs pinned tabs.** Chrome keeps pins at the front of the strip
  and refuses to put an unpinned tab before them, so unpinned app tabs queue up
  just after the last pin. A pinned app tab sorts within the pinned run instead.

Group also adopts: after a browser restart the dock has no live links yet, so the
first Group finds your already-open Gmail and Linear tabs, claims them, and
orders them — the reload buttons appear as a side effect.

## Layout

| File | Role |
| --- | --- |
| `manifest.json` | MV3 manifest: popup, permissions, keyboard command. |
| `background.js` | Service worker. Owns the appId → tabId mapping and launching. |
| `scope.js` | Pure scope matching and tab resolution, shared with the tests. |
| `settings.js` | Pure settings shape and the in-page permission constants. |
| `content.js` | The in-page triangle, the shortcut bar, and the panel that frames the popup. |
| `newtab.{html,css,js}` | The new tab page: search box and app grid. |
| `grouping.js` | Pure move planning for Group, shared with the tests. |
| `popup.{html,css,js}` | The dock UI. Renders, edits, and asks the worker to launch. |
| `test/scope.test.mjs` | Scope matching tests. |
| `test/grouping.test.mjs` | Move planning and tab resolution tests. |
| `test/settings.test.mjs` | Settings defaults and the setting/permission pair. |
| `icons/make-icons.py` | Regenerates the icon PNGs. No dependencies. |

```sh
npm test                      # 31 tests
python3 icons/make-icons.py   # re-render the icons after editing the layout
```

## Why not the native bookmarks bar?

Extensions cannot draw into Chrome's own UI, and there is no API for
intercepting a click on a native bookmark. The closest workaround is to watch
`chrome.webNavigation.onCommitted` for `transitionType === "auto_bookmark"` and
close the duplicate tab after the fact — which works, but flashes a tab first
and is awkward when the click navigates the current tab instead of opening a new
one. The popup owns its own clicks, so none of that is needed.
