/**
 * Offline harness for the VS Code scrollbar + minimap Client half.
 *
 * Loads client.js with a small browser stand-in (elements, layout rectangles,
 * observers, window listeners) and exercises both features without a browser:
 *   - the stylesheet is attached once and removed on disposal
 *   - the nearest scrollable ancestor of a conversation anchor is tagged, a
 *     non-scrollable ancestor is left alone, a re-rendered body is re-tagged
 *   - the minimap layer mounts, measures the chat column, scales the clone and
 *     positions the viewport slider from the scroll position
 *   - a click on the preview maps back to scrollTop; scrolling moves the slider
 *   - the preview hides on a too-narrow pane and returns when widened
 *   - conversation mutations rebuild the preview
 *   - disposal removes the sheet, markers, preview, observers and listeners
 *
 * Run: node test/harness.mjs client.js
 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const CLIENT_PATH = process.argv[2];
if (!CLIENT_PATH) throw new Error('usage: node test/harness.mjs <client.js>');

const MARKER = 'data-dsh-vscode-scrollbar';
const HOST_SELECTOR = '[data-slot="conversation.session"]';
const MINIMAP = 'data-dsh-vscode-minimap';
const PREVIEW = 'data-dsh-vscode-minimap-preview';
const CLONE = 'data-dsh-vscode-minimap-clone';
const SLIDER = 'data-dsh-vscode-minimap-slider';
const VISIBLE = 'data-visible';
const SCAN_DELAY_MS = 120;
const SYNC_DELAY_MS = 350;
const RESIZE_DELAY_MS = 80;
const MINIMAP_WIDTH = 80;
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
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.scrollWidth = 0;
    this.scrollHeight = 0;
    this.scrollTop = 0;
    this.rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this.listeners = new Map();
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
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    for (const node of nodes) this.appendChild(node);
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
  getBoundingClientRect() {
    return { ...this.rect };
  }
  cloneNode(deep) {
    const copy = new Element(this.tagName, Object.fromEntries(this.attributes));
    copy.dataset = { ...this.dataset };
    copy.style = { ...this.style };
    copy.textContent = this.textContent;
    copy.overflowY = this.overflowY;
    copy.rect = { ...this.rect };
    copy.clientWidth = this.clientWidth;
    copy.clientHeight = this.clientHeight;
    copy.offsetWidth = this.offsetWidth;
    copy.offsetHeight = this.offsetHeight;
    copy.scrollWidth = this.scrollWidth;
    copy.scrollHeight = this.scrollHeight;
    copy.scrollTop = this.scrollTop;
    if (deep === true) {
      for (const child of this.children) copy.appendChild(child.cloneNode(true));
    }
    return copy;
  }
  addEventListener(type, listener) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
  dispatch(type, properties = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      ...properties,
    };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    return event;
  }
}

function place(element, rect) {
  element.rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, ...rect };
  element.rect.right = element.rect.left + element.rect.width;
  element.rect.bottom = element.rect.top + element.rect.height;
  return element;
}

function box(element, dimensions) {
  Object.assign(element, dimensions);
  return element;
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

function findAttr(name) {
  return descendants().find((node) => node.hasAttribute(name)) ?? null;
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

const mutationObservers = new Set();
class MutationObserverStub {
  constructor(callback) {
    this.callback = callback;
    this.active = false;
    this.target = null;
    this.options = {};
  }
  observe(target, options) {
    this.active = true;
    this.target = target;
    this.options = options ?? {};
    mutationObservers.add(this);
  }
  disconnect() {
    this.active = false;
    mutationObservers.delete(this);
  }
}

function isAncestor(ancestor, node) {
  let current = node;
  while (current !== null) {
    if (current === ancestor) return true;
    current = current.parentElement;
  }
  return false;
}

function fireMutations(target) {
  for (const observer of [...mutationObservers]) {
    if (!observer.active) continue;
    const within = observer.target === target || (observer.options.subtree === true && isAncestor(observer.target, target));
    if (within) observer.callback([]);
  }
}

const windowListeners = new Map();
function addWindowListener(type, listener) {
  const set = windowListeners.get(type) ?? new Set();
  set.add(listener);
  windowListeners.set(type, set);
}
function removeWindowListener(type, listener) {
  windowListeners.get(type)?.delete(listener);
}
function fireWindow(type, event = {}) {
  for (const listener of [...(windowListeners.get(type) ?? [])]) listener(event);
}

const resizeObservers = new Set();
class ResizeObserverStub {
  constructor(callback) {
    this.callback = callback;
    this.active = false;
  }
  observe(target) {
    this.active = true;
    this.target = target;
    resizeObservers.add(this);
  }
  disconnect() {
    this.active = false;
    resizeObservers.delete(this);
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

let frameId = 0;
globalThis.window = globalThis;
globalThis.window.__ModuleLoader__ = { load(definition) { moduleFactory = definition.factory; } };
globalThis.document = documentStub;
globalThis.MutationObserver = MutationObserverStub;
globalThis.ResizeObserver = ResizeObserverStub;
globalThis.getComputedStyle = (element) => ({ overflowY: element.overflowY });
globalThis.addEventListener = addWindowListener;
globalThis.removeEventListener = removeWindowListener;
globalThis.requestAnimationFrame = (callback) => {
  frameId += 1;
  setTimeout(() => callback(frameId), 0);
  return frameId;
};
globalThis.cancelAnimationFrame = () => {};
let moduleFactory = null;

// ------------------------------------------------------------------- load it --
await import(pathToFileURL(CLIENT_PATH).href);
assert.ok(moduleFactory, 'client module registered a factory');
const plugin = moduleFactory(() => {
  throw new Error('harness: the plugin must not require browser modules');
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
place(scrollBody, { top: 40, left: 0, width: 1790, height: 1000 });
box(scrollBody, { clientWidth: 1776, clientHeight: 1000, offsetWidth: 1790, offsetHeight: 1000, scrollHeight: 4000, scrollTop: 0 });
const anchor = scrollBody.appendChild(new Element('div', { 'data-slot': 'conversation.session' }));
// Slot anchors render with `display: contents` in the real client: no box, no
// size. The minimap must measure against the pane in that case.
place(anchor, { top: 40, left: 0, width: 0, height: 0 });
const flow = anchor.appendChild(new Element('div'));
place(flow, { top: 40, left: 428, width: 920, height: 3800 });
flow.setAttribute('id', 'flow');
const image = flow.appendChild(new Element('img'));

plugin.apply(ctx);
assert.equal(cleanups.length, 1, 'apply registered one effect');
assert.equal(head.children.length, 1, 'one stylesheet attached');
assert.match(head.children[0].textContent, /::-webkit-scrollbar-thumb/, 'thumb rules present');
assert.match(head.children[0].textContent, /14px/, 'VS Code size present');
assert.match(head.children[0].textContent, /data-dsh-vscode-minimap/, 'minimap rules present');
assert.equal(head.children[0].dataset.plugin, 'dsh-vscode-scrollbar', 'sheet is tagged as plugin-owned');
assert.ok(scrollBody.hasAttribute(MARKER), 'scroll container tagged');
assert.ok(!appRoot.hasAttribute(MARKER), 'non-scrollable ancestor not tagged');
assert.ok(!anchor.hasAttribute(MARKER), 'anchor itself not tagged');

const minimap = findAttr(MINIMAP);
assert.ok(minimap, 'minimap layer created');
assert.ok(minimap.hasAttribute(VISIBLE), 'minimap visible on a wide, long conversation');
assert.equal(minimap.style.top, '40px', 'minimap tracks the scroll container top');
assert.equal(minimap.style.left, String(1790 - 14 - 6 - MINIMAP_WIDTH) + 'px', 'minimap sits left of the 14px scrollbar');
assert.equal(minimap.style.width, MINIMAP_WIDTH + 'px', 'minimap width');
assert.equal(minimap.style.height, '1000px', 'minimap height equals the viewport');

const preview = findAttr(PREVIEW);
const clone = findAttr(CLONE);
const slider = findAttr(SLIDER);
assert.ok(preview && clone && slider, 'preview, clone and slider exist');
assert.equal(preview.children.length, 1, 'preview holds exactly one clone');
assert.equal(clone.style.display, 'block', 'clone is forced into a real box despite the display:contents anchor');
assert.equal(clone.style.width, '1776px', 'clone is laid out at the pane width');
assert.equal(
  clone.style.transform,
  'scale(0.08696,0.08696) translate(-428.00px,0px)',
  'clone is scaled to the column and shifted to the left edge',
);
assert.equal(clone.children[0].getAttribute('id'), null, 'clone ids stripped');
assert.equal(clone.children[0].children.some((child) => child.tagName === 'img'), false, 'clone media stripped');
const expectedScale = MINIMAP_WIDTH / 920; // 920px chat column inside the 1776px pane
assert.equal(slider.style.height, Math.round(1000 * expectedScale) + 'px', 'slider height is the viewport fraction');
assert.equal(slider.style.top, '0px', 'slider starts at the top');

// -------------------------------------------------- 2. non-scrollable parent --
const hiddenRoot = body.appendChild(new Element('div'));
hiddenRoot.overflowY = 'hidden';
const hiddenAnchor = hiddenRoot.appendChild(new Element('div', { 'data-slot': 'conversation.session' }));
hiddenAnchor.appendChild(new Element('div'));
fireMutations(body);
await sleep(SCAN_DELAY_MS + 80);
assert.ok(!hiddenRoot.hasAttribute(MARKER), 'overflow:hidden container stays untouched');
assert.equal(head.children.length, 1, 'no second stylesheet on rescan');

// ----------------------------------------------------- 3. conversation redraw --
const redrawnBody = appRoot.appendChild(new Element('div'));
redrawnBody.overflowY = 'auto';
place(redrawnBody, { top: 40, left: 0, width: 1600, height: 900 });
box(redrawnBody, { clientWidth: 1586, clientHeight: 900, offsetWidth: 1600, offsetHeight: 900, scrollHeight: 5200, scrollTop: 0 });
const redrawnAnchor = redrawnBody.appendChild(new Element('div', { 'data-slot': 'conversation.session' }));
place(redrawnAnchor, { top: 40, left: 0, width: 0, height: 0 });
const redrawnFlow = redrawnAnchor.appendChild(new Element('div'));
place(redrawnFlow, { top: 40, left: 333, width: 920, height: 5000 });
redrawnFlow.dataset.marker = 'redrawn';
scrollBody.remove();
fireMutations(body);
await sleep(SCAN_DELAY_MS + 80);
assert.ok(redrawnBody.hasAttribute(MARKER), 're-rendered conversation re-tagged');
assert.ok(!hiddenRoot.hasAttribute(MARKER), 'hidden one still untouched');
const previewClone = findAttr(CLONE);
assert.notEqual(previewClone, clone, 'preview rebound to the new conversation');
assert.equal(previewClone.children[0].dataset.marker, 'redrawn', 'preview clones the new conversation content');
const redrawnScale = MINIMAP_WIDTH / 920;
assert.equal(findAttr(SLIDER).style.height, Math.round(900 * redrawnScale) + 'px', 'slider re-measured for the new pane');

// -------------------------------------------- 4. narrow pane hides the minimap --
box(redrawnBody, { clientWidth: 900, offsetWidth: 914 });
place(redrawnBody, { top: 40, left: 0, width: 900, height: 900 });
fireWindow('resize');
await sleep(RESIZE_DELAY_MS + 80);
assert.ok(!findAttr(MINIMAP).hasAttribute(VISIBLE), 'minimap hides when the pane is too narrow for the margin');
box(redrawnBody, { clientWidth: 1586, offsetWidth: 1600 });
place(redrawnBody, { top: 40, left: 0, width: 1600, height: 900 });
fireWindow('resize');
await sleep(RESIZE_DELAY_MS + 80);
assert.ok(findAttr(MINIMAP).hasAttribute(VISIBLE), 'minimap returns when widened again');

// -------------------------------------------------- 5. click previews navigation --
redrawnBody.scrollTop = 0;
findAttr(MINIMAP).dispatch('mousedown', { clientY: 200, clientX: 1400 });
const expectedScrollTop = Math.round(200 / redrawnScale - 900 / 2);
assert.equal(redrawnBody.scrollTop, expectedScrollTop, 'click maps to the pane scroll position');
assert.equal(
  findAttr(SLIDER).style.top,
  String(Math.round(expectedScrollTop * redrawnScale)) + 'px',
  'slider follows a click jump',
);

// ------------------------------------------------ 6. mutations rebuild the clone --
const beforeMutation = findAttr(CLONE);
const streamed = redrawnFlow.appendChild(new Element('div'));
streamed.dataset.marker = 'fresh';
fireMutations(redrawnAnchor);
await sleep(SYNC_DELAY_MS + 120);
const afterMutation = findAttr(CLONE);
assert.notEqual(afterMutation, beforeMutation, 'conversation mutation rebuilt the preview');
assert.equal(afterMutation.children[0].dataset.marker, 'redrawn', 'preview content kept');
assert.ok(afterMutation.children[0].children.some((child) => child.dataset.marker === 'fresh'), 'new row is in the preview');

// --------------------------------------------------------------- 7. disposal --
cleanups[0]();
assert.equal(head.children.length, 0, 'stylesheet removed');
assert.equal(findAttr(MINIMAP), null, 'minimap layer removed');
assert.equal(findAttr(CLONE), null, 'clone removed');
assert.ok(!redrawnBody.hasAttribute(MARKER), 'marker removed on disposal');
assert.equal(mutationObservers.size, 0, 'mutation observers disconnected on disposal');
assert.equal(resizeObservers.size, 0, 'resize observer disconnected on disposal');
assert.equal(windowListeners.get('resize')?.size ?? 0, 0, 'window resize listener removed');
assert.equal(body.children.length, 2, 'DOM otherwise restored');

console.log('dsh-vscode-scrollbar: client harness passed (scrollbar + minimap, tagging, navigation, retag, disposal)');
