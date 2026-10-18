/**
 * Offline harness for the VS Code scrollbar Client half.
 *
 * Loads client.js with a minimal browser stand-in, then exercises the tagging
 * logic and the disposal path without a real browser:
 *   - the stylesheet is attached exactly once and removed on disposal
 *   - the nearest scrollable ancestor of a conversation session anchor is tagged
 *   - a non-scrollable ancestor is left alone
 *   - a re-rendered conversation body is re-tagged after a mutation
 *   - the marker and the `MutationObserver` are cleaned up on disposal
 *
 * Run: node test/harness.mjs client.js
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const CLIENT_PATH = process.argv[2];
if (!CLIENT_PATH) throw new Error('usage: node test/harness.mjs <client.js>');

const MARKER = 'data-dsh-vscode-scrollbar';
const HOST_SELECTOR = '[data-slot="conversation.session"]';
const SCAN_DELAY_MS = 120;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ DOM stub --
class Element {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName;
    this.attributes = new Map(Object.entries(attributes));
    this.parentElement = null;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.textContent = '';
    this.overflowY = 'visible';
  }
  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  append(child) {
    return this.appendChild(child);
  }
  remove() {
    if (this.parentElement === null) return;
    this.parentElement.children = this.parentElement.children.filter((entry) => entry !== this);
    this.parentElement = null;
  }
  hasAttribute(name) {
    return this.attributes.has(name);
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
}

const html = new Element('html');
const head = html.appendChild(new Element('head'));
const body = html.appendChild(new Element('body'));

function descendants() {
  const out = [];
  const visit = (node) => {
    for (const child of node.children) {
      out.push(child);
      visit(child);
    }
  };
  visit(html);
  return out;
}

function query(selector) {
  if (selector === HOST_SELECTOR) {
    return descendants().filter((node) => node.getAttribute('data-slot') === 'conversation.session');
  }
  if (selector === '[' + MARKER + ']') {
    return descendants().filter((node) => node.hasAttribute(MARKER));
  }
  const styled = /^style\[data-plugin-css=(.+)\]$/.exec(selector);
  if (styled !== null) {
    const wanted = JSON.parse(styled[1]);
    return descendants().filter((node) => node.tagName === 'style' && node.dataset.pluginCss === wanted);
  }
  throw new Error('harness: unsupported selector ' + selector);
}

let observerCallback = null;
let observerActive = false;
class MutationObserverStub {
  constructor(callback) {
    observerCallback = callback;
  }
  observe() {
    observerActive = true;
  }
  disconnect() {
    observerActive = false;
    observerCallback = null;
  }
}

const documentStub = {
  body,
  head,
  documentElement: html,
  createElement(tagName) {
    return new Element(tagName);
  },
  querySelector(selector) {
    return query(selector)[0] ?? null;
  },
  querySelectorAll(selector) {
    return query(selector);
  },
};

let moduleFactory = null;
globalThis.window = globalThis;
globalThis.window.__ModuleLoader__ = { load(definition) { moduleFactory = definition.factory; } };
globalThis.document = documentStub;
globalThis.MutationObserver = MutationObserverStub;
globalThis.getComputedStyle = (element) => ({ overflowY: element.overflowY });

// ------------------------------------------------------------------- load it --
await import(pathToFileURL(CLIENT_PATH).href);
assert.ok(moduleFactory, 'client module registered a factory');
const plugin = moduleFactory(() => {
  throw new Error('harness: the scrollbar plugin must not require browser modules');
});
assert.equal(typeof plugin.apply, 'function', 'factory returned { apply }');

const cleanups = [];
const ctx = {
  effect(callback) {
    const cleanup = callback();
    if (typeof cleanup === 'function') cleanups.push(cleanup);
    return cleanup;
  },
};

// ------------------------------------------------------------- 1. first mount --
const appRoot = body.appendChild(new Element('div'));
const scrollBody = appRoot.appendChild(new Element('div'));
scrollBody.overflowY = 'auto';
const anchor = scrollBody.appendChild(new Element('div', { 'data-slot': 'conversation.session' }));
anchor.appendChild(new Element('div'));

plugin.apply(ctx);
assert.equal(cleanups.length, 1, 'apply registered one effect');
assert.equal(head.children.length, 1, 'one stylesheet attached');
assert.match(head.children[0].textContent, /::-webkit-scrollbar-thumb/, 'thumb rules present');
assert.match(head.children[0].textContent, /14px/, 'VS Code size present');
assert.equal(head.children[0].dataset.plugin, 'dsh-vscode-scrollbar', 'sheet is tagged as plugin-owned');
assert.ok(scrollBody.hasAttribute(MARKER), 'scroll container tagged');
assert.ok(!appRoot.hasAttribute(MARKER), 'non-scrollable ancestor not tagged');
assert.ok(!anchor.hasAttribute(MARKER), 'anchor itself not tagged');
assert.ok(observerActive, 'mutation observer observing');

// -------------------------------------------------- 2. non-scrollable parent --
const hiddenRoot = body.appendChild(new Element('div'));
hiddenRoot.overflowY = 'hidden';
const hiddenAnchor = hiddenRoot.appendChild(new Element('div', { 'data-slot': 'conversation.session' }));
hiddenAnchor.appendChild(new Element('div'));
observerCallback();
await sleep(SCAN_DELAY_MS + 80);
assert.ok(!hiddenRoot.hasAttribute(MARKER), 'overflow:hidden container stays untouched');
assert.equal(head.children.length, 1, 'no second stylesheet on rescan');

// ----------------------------------------------------- 3. conversation redraw --
const redrawnBody = appRoot.appendChild(new Element('div'));
redrawnBody.overflowY = 'auto';
const redrawnAnchor = redrawnBody.appendChild(new Element('div', { 'data-slot': 'conversation.session' }));
redrawnAnchor.appendChild(new Element('div'));
scrollBody.remove();
observerCallback();
await sleep(SCAN_DELAY_MS + 80);
assert.ok(redrawnBody.hasAttribute(MARKER), 're-rendered conversation re-tagged');
assert.ok(!hiddenRoot.hasAttribute(MARKER), 'hidden one still untouched');

// --------------------------------------------------------------- 4. disposal --
cleanups[0]();
assert.equal(head.children.length, 0, 'stylesheet removed');
assert.ok(!redrawnBody.hasAttribute(MARKER), 'marker removed on disposal');
assert.ok(!observerActive, 'observer disconnected on disposal');
assert.equal(body.children.length, 2, 'DOM otherwise restored');

console.log('dsh-vscode-scrollbar: client harness passed (tagging, retag, disposal)');
