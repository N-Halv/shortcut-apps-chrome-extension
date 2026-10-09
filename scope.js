// Pure scope matching, shared by the service worker and the tests.

export function parseURL(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function tabURL(tab) {
  return tab.url || tab.pendingUrl || "";
}

// Does `url` still count as "inside" this app? Host match is the default,
// optionally widened to subdomains or narrowed by a path prefix, so that
// mail.google.com and docs.google.com are separate apps while one Notion
// workspace can be pinned to notion.so/my-team/.
export function inScope(url, app) {
  const target = parseURL(url);
  if (!target || (target.protocol !== "https:" && target.protocol !== "http:")) return false;

  const scope = app.scope ?? {};
  const scopeHost = (scope.host || parseURL(app.url)?.hostname || "").toLowerCase();
  if (!scopeHost) return false;

  const host = target.hostname.toLowerCase();
  const hostMatches = scope.matchSubdomains
    ? host === scopeHost || host.endsWith(`.${scopeHost}`)
    : host === scopeHost;
  if (!hostMatches) return false;

  const prefix = scope.pathPrefix || "";
  return !prefix || target.pathname.startsWith(prefix);
}

// Find the tab that currently *is* this app, or null. Never opens anything.
// `claimed` holds tab ids already spoken for, so that two apps with
// overlapping scopes cannot adopt the same tab in a single pass.
export function findTab(app, links, tabs, claimed) {
  const linkedId = links[app.id];
  if (typeof linkedId === "number") {
    const linked = tabs.find((tab) => tab.id === linkedId);
    if (linked && inScope(tabURL(linked), app)) return linked;
  }

  if (app.adopt === false) return null;
  return tabs.find((tab) => !claimed.has(tab.id) && inScope(tabURL(tab), app)) ?? null;
}
