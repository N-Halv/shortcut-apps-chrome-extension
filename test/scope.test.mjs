import { strict as assert } from "node:assert";
import test from "node:test";

import { inScope } from "../scope.js";

const gmail = { url: "https://mail.google.com/mail/u/0/", scope: { host: "mail.google.com" } };
const notion = {
  url: "https://www.notion.so/my-team/Home",
  scope: { host: "www.notion.so", pathPrefix: "/my-team/" },
};
const github = { url: "https://github.com/", scope: { host: "github.com", matchSubdomains: true } };
const bare = { url: "https://example.com/start" };

test("a different route on the same host stays in scope", () => {
  assert.equal(inScope("https://mail.google.com/mail/u/0/#inbox/abc123", gmail), true);
  assert.equal(inScope("https://mail.google.com/chat/u/0/", gmail), true);
});

test("a sibling host is a different app", () => {
  assert.equal(inScope("https://docs.google.com/document/d/1", gmail), false);
  assert.equal(inScope("https://google.com/", gmail), false);
});

test("navigating away from the host leaves scope", () => {
  assert.equal(inScope("https://news.ycombinator.com/", gmail), false);
});

test("subdomains only match when asked for", () => {
  assert.equal(inScope("https://gist.github.com/nate", github), true);
  assert.equal(inScope("https://github.com/nate/repo", github), true);
  assert.equal(inScope("https://notgithub.com/", github), false);
  // A lookalike suffix must not slip through the endsWith check.
  assert.equal(inScope("https://evilgithub.com/", github), false);
});

test("a path prefix narrows the app to one workspace", () => {
  assert.equal(inScope("https://www.notion.so/my-team/Roadmap-abc", notion), true);
  assert.equal(inScope("https://www.notion.so/other-team/Home", notion), false);
});

test("scope host falls back to the launch URL's host", () => {
  assert.equal(inScope("https://example.com/elsewhere", bare), true);
  assert.equal(inScope("https://other.com/", bare), false);
});

test("host comparison ignores case", () => {
  assert.equal(inScope("https://MAIL.google.COM/mail", gmail), true);
});

test("non-http schemes never match", () => {
  assert.equal(inScope("chrome://settings", gmail), false);
  assert.equal(inScope("about:blank", gmail), false);
  assert.equal(inScope("", gmail), false);
  assert.equal(inScope("file:///Users/nate/notes.md", bare), false);
});
