/**
 * Offline harness for `client.js` — no browser, no DSH.
 *
 * The module only sees the DOM through a handful of calls, so this file
 * implements just those: elements with an attribute map, a style object,
 * listeners, layout boxes and observers. It then drives the plugin through the
 * cases that broke in the live app: the chat column measured from the live
 * `[data-chat-flow-kind]` rows (a `display: contents` anchor has no box), a
 * preview that fills the pane (images are part of a chat's height), and a
 * viewport slider that mirrors the scroller's own scrollbar ratio.
 *
 * Run with: node test/harness.mjs client.js
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '..', 'client.js'), 'utf8');
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const SCAN_WAIT = 200;
const SYNC_WAIT = 420;
const RESIZE_WAIT = 160;

const kebab = (value) => value.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
const camel = (value) => value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

/** Supported selectors: `tag[attr="value"]`, `[attr="value"]`, `[attr]`. */
function parseSelector(selector) {
  const match = /^([a-zA-Z0-9]*)\[([a-zA-Z-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (match === null) throw new Error('harness: unsupported selector ' + selector);
  return { tag: match[1].toLowerCase(), name: match[2], value: match[3] };
}

function matches(element, selector) {
  const { tag, name, value } = parseSelector(selector);
  if (tag !== '' && element.tagName !== tag) return false;
  const actual = element.getAttribute(name);
  if (value === undefined) return actual !== null;
  return actual === value;
}

function walk(element, visit) {
  for (const child of element.children) {
    visit(child);
    walk(child, visit);
  }
}

function detach(element) {
  const parent = element.parentElement;
  if (parent === null) return;
  const index = parent.children.indexOf(element);
  if (index !== -1) parent.children.splice(index, 1);
  element.parentElement = null;
}

class FakeStyle {
  setProperty(name, value) {
    this[name] = String(value);
  }

  getPropertyValue(name) {
    return this[name] ?? '';
  }

  clone() {
    const copy = new FakeStyle();
    Object.assign(copy, this);
    return copy;
  }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.parentElement = null;
    this.children = [];
    this.attributes = new Map();
    this.style = new FakeStyle();
    this.listeners = new Map();
    this.rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    this.scrollTop = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.clientWidth = 0;
    this.offsetWidth = 0;
    this.overflowY = 'visible';
    this.textContent = '';
    this.offsetHeightOverride = undefined;
    const attributes = this.attributes;
    const style = this.style;
    this.dataset = new Proxy({}, {
      set: (_, property, value) => {
        attributes.set('data-' + kebab(String(property)), String(value));
        return true;
      },
      get: (_, property) => {
        const value = attributes.get('data-' + kebab(String(property)));
        if (value !== undefined) return value;
        return style['data-' + kebab(String(property))];
      },
    });
  }

  get childElementCount() {
    return this.children.length;
  }

  get firstElementChild() {
    return this.children[0] ?? null;
  }

  get offsetHeight() {
    if (this.offsetHeightOverride !== undefined) return this.offsetHeightOverride;
    let total = 0;
    for (const child of this.children) total += child.offsetHeight || 0;
    return total;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    detach(child);
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...nodes) {
    for (const child of this.children.splice(0)) child.parentElement = null;
    for (const node of nodes) this.appendChild(node);
  }

  remove() {
    detach(this);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type);
    if (handlers !== undefined) handlers.delete(handler);
  }

  dispatch(type, properties = {}) {
    const event = {
      type,
      button: 0,
      preventDefault() {},
      ...properties,
    };
    for (const handler of Array.from(this.listeners.get(type) ?? [])) handler(event);
  }

  getBoundingClientRect() {
    return { ...this.rect };
  }

  querySelectorAll(selector) {
    const found = [];
    walk(this, (element) => {
      if (matches(element, selector)) found.push(element);
    });
    return found;
  }

  cloneNode(deep) {
    const copy = new FakeElement(this.tagName);
    copy.attributes = new Map(this.attributes);
    copy.style = this.style.clone();
    copy.rect = { ...this.rect };
    copy.scrollTop = this.scrollTop;
    copy.scrollHeight = this.scrollHeight;
    copy.clientHeight = this.clientHeight;
    copy.clientWidth = this.clientWidth;
    copy.offsetWidth = this.offsetWidth;
    copy.offsetHeightOverride = this.offsetHeightOverride;
    copy.overflowY = this.overflowY;
    copy.textContent = this.textContent;
    if (deep) {
      for (const child of this.children) copy.appendChild(child.cloneNode(true));
    }
    return copy;
  }
}

const documentElement = new FakeElement('#document');
documentElement.clientWidth = 1776;
documentElement.clientHeight = 1109;
const body = new FakeElement('body');
const head = new FakeElement('head');
documentElement.appendChild(body);

const documentStub = {
  documentElement,
  body,
  head,
  createElement(tagName) {
    return new FakeElement(tagName);
  },
  querySelector(selector) {
    return documentStub.querySelectorAll(selector)[0] ?? null;
  },
  querySelectorAll(selector) {
    const found = [];
    walk(head, (element) => {
      if (matches(element, selector)) found.push(element);
    });
    walk(body, (element) => {
      if (matches(element, selector)) found.push(element);
    });
    return found;
  },
};

const mutationObservers = new Set();
const resizeObservers = new Set();
const windowListeners = new Map();

const isAncestor = (candidate, node) => {
  let current = node.parentElement;
  while (current !== null) {
    if (current === candidate) return true;
    current = current.parentElement;
  }
  return false;
};

class FakeMutationObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = new Set();
    mutationObservers.add(this);
  }

  observe(target) {
    this.targets.add(target);
  }

  disconnect() {
    this.targets.clear();
    mutationObservers.delete(this);
  }
}

class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    resizeObservers.add(this);
  }

  observe() {}

  disconnect() {
    resizeObservers.delete(this);
  }
}

const windowStub = {
  __ModuleLoader__: {
    load(module) {
      windowStub.module = module;
    },
  },
  setTimeout,
  clearTimeout,
  addEventListener(type, handler) {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type).add(handler);
  },
  removeEventListener(type, handler) {
    const handlers = windowListeners.get(type);
    if (handlers !== undefined) handlers.delete(handler);
  },
  getComputedStyle(element) {
    return { overflowY: element.overflowY || 'visible' };
  },
  MutationObserver: FakeMutationObserver,
  ResizeObserver: FakeResizeObserver,
};

const fireMutations = (target) => {
  for (const observer of Array.from(mutationObservers)) {
    for (const observed of observer.targets) {
      if (observed === target || isAncestor(observed, target)) {
        observer.callback([{ type: 'childList' }], observer);
        break;
      }
    }
  }
};

const fireResize = () => {
  for (const observer of Array.from(resizeObservers)) observer.callback([], observer);
};

const fireWindow = (type, properties = {}) => {
  const event = { type, ...properties };
  for (const handler of Array.from(windowListeners.get(type) ?? [])) handler(event);
};

const createScene = ({ clientWidth = 1776, clientHeight = 1000, contentHeight = 5800, scrollHeight = 6000, rowWidth = 920, rows = 3 } = {}) => {
  const scroller = new FakeElement('div');
  scroller.overflowY = 'auto';
  scroller.clientWidth = clientWidth;
  scroller.offsetWidth = clientWidth + 14;
  scroller.clientHeight = clientHeight;
  scroller.scrollHeight = scrollHeight;
  scroller.rect = {
    top: 40,
    left: 280,
    right: 280 + clientWidth + 14,
    bottom: 40 + clientHeight,
    width: clientWidth + 14,
    height: clientHeight,
  };

  const anchor = new FakeElement('div');
  anchor.setAttribute('data-slot', 'conversation.session');
  // `display: contents` semantics: the outlet wrapper has no box at all.
  anchor.rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };

  const flow = new FakeElement('div');
  flow.setAttribute('id', 'harness-flow');
  flow.offsetHeightOverride = contentHeight;
  flow.rect = { top: 40, left: 280 + (clientWidth - rowWidth) / 2, right: 0, bottom: 0, width: rowWidth, height: contentHeight };
  for (let index = 0; index < rows; index += 1) {
    const row = new FakeElement('div');
    row.setAttribute('data-chat-flow-kind', index === 0 ? 'user' : 'assistant-step');
    row.rect = { top: 40, left: flow.rect.left, right: 0, bottom: 0, width: rowWidth, height: Math.round(contentHeight / rows) };
    flow.appendChild(row);
  }
  const image = new FakeElement('img');
  image.rect = { top: 40, left: flow.rect.left, right: 0, bottom: 0, width: 800, height: 400 };
  flow.appendChild(image);
  const video = new FakeElement('video');
  flow.appendChild(video);

  anchor.appendChild(flow);
  scroller.appendChild(anchor);
  body.appendChild(scroller);
  return { scroller, anchor, flow };
};

const overlay = () => documentStub.querySelectorAll('[data-dsh-vscode-minimap]')[0] ?? null;
const cloneOf = () => documentStub.querySelectorAll('[data-dsh-vscode-minimap-clone]')[0] ?? null;
const sliderOf = () => documentStub.querySelectorAll('[data-dsh-vscode-minimap-slider]')[0] ?? null;
const markers = () => documentStub.querySelectorAll('[data-dsh-vscode-scrollbar]');

new Function('window', 'document', source)(windowStub, documentStub);
assert.ok(windowStub.module !== undefined, 'module loader captured the client half');
assert.equal(windowStub.module.id, 'dsh-vscode-scrollbar');

let dispose = null;
windowStub.module.factory().apply({
  effect(setup) {
    dispose = setup();
  },
});

const { scroller, anchor, flow } = createScene();
fireMutations(body);
await sleep(SCAN_WAIT);

// --- 1. mount -----------------------------------------------------------------
const styleTags = documentStub.querySelectorAll('style[data-plugin-css="dsh-vscode-scrollbar/VscodeScrollbar.css"]');
assert.equal(styleTags.length, 1, 'one stylesheet is attached');
assert.ok(styleTags[0].textContent.includes('::-webkit-scrollbar-thumb'), 'stylesheet carries the scrollbar rules');
assert.ok(styleTags[0].textContent.includes('14px'), 'stylesheet uses the 14px VS Code size');
assert.equal(markers().length, 1, 'conversation scroller is tagged');
assert.equal(markers()[0], scroller, 'the nearest scrollable ancestor is tagged');

const overlayNode = overlay();
assert.ok(overlayNode !== null, 'minimap overlay exists');
assert.notEqual(overlayNode.getAttribute('data-visible'), null, 'minimap is visible at 1776px');
assert.equal(overlayNode.style.left, '1970px', 'overlay sits flush against the scrollbar (right - 14 - 6 - 80)');
assert.equal(overlayNode.style.top, '40px', 'overlay starts at the scroller top');
assert.equal(overlayNode.style.width, '80px', 'overlay uses the VS Code minimap width');
assert.equal(overlayNode.style.height, '1000px', 'overlay matches the viewport height');

let clone = cloneOf();
assert.ok(clone !== null, 'preview clone exists');
assert.equal(clone.style.display, 'block', 'clone is forced into a real box despite the display:contents anchor');
assert.equal(clone.style.width, '1776px', 'clone is as wide as the scroller content box');
assert.equal(clone.style.getPropertyValue('--dsh-chat-content-width'), '920px', 'clone reproduces the measured chat column');
assert.equal(clone.style.transform, 'scale(0.08696,0.17241) translate(-428.00px,0px)', 'column scaled to 80px, content fitted to 1000px, centred column shifted to x=0');
assert.equal(clone.getAttribute('data-dsh-vscode-minimap-clone'), '');

const cloneTags = [];
const cloneIds = [];
walk(clone, (element) => {
  cloneTags.push(element.tagName);
  if (element.getAttribute('id') !== null) cloneIds.push(element.getAttribute('id'));
});
assert.ok(cloneTags.includes('img'), 'images stay in the preview (they are most of a chat height)');
assert.ok(!cloneTags.includes('video'), 'media that would play again is stripped');
assert.deepEqual(cloneIds, [], 'ids are stripped from the clone');
for (const child of clone.querySelectorAll('[data-chat-flow-kind]')) {
  assert.equal(child.rect.width, 920, 'row boxes are cloned');
}

const slider = sliderOf();
assert.equal(slider.style.height, '167px', 'viewport thumb is the viewport fraction of the content');
assert.equal(slider.style.top, '0px', 'thumb starts at the top');

// --- 2. scrolling moves the slider only ---------------------------------------
const cloneBeforeScroll = cloneOf();
scroller.scrollTop = 2500;
scroller.dispatch('scroll');
await sleep(40);
assert.equal(slider.style.top, '417px', 'half-way scroll puts the thumb half-way down the track');
assert.equal(cloneOf(), cloneBeforeScroll, 'scrolling does not rebuild the preview');

// --- 3. clicking the track jumps to that position ------------------------------
scroller.scrollTop = 0;
scroller.dispatch('scroll');
await sleep(40);
assert.equal(slider.style.top, '0px');
overlayNode.dispatch('mousedown', { clientY: 500, button: 0 });
assert.equal(scroller.scrollTop, 2500, 'clicking the middle of the track centres the viewport there');

// --- 4. dragging the slider scrolls proportionally ----------------------------
scroller.scrollTop = 0;
scroller.dispatch('scroll');
await sleep(40);
overlayNode.dispatch('mousedown', { clientY: 50, button: 0 });
fireWindow('mousemove', { clientY: 50 + 833 / 2 });
assert.equal(scroller.scrollTop, 2500, 'dragging the thumb by half the travel scrolls half the range');
fireWindow('mouseup');

// --- 5. new content rebuilds the preview --------------------------------------
const staleClone = cloneOf();
const extraRow = new FakeElement('div');
extraRow.setAttribute('data-chat-flow-kind', 'assistant-step');
extraRow.rect = { top: 0, left: flow.rect.left, right: 0, bottom: 0, width: 920, height: 300 };
flow.appendChild(extraRow);
fireMutations(anchor);
await sleep(SYNC_WAIT);
assert.ok(cloneOf() !== staleClone, 'a conversation mutation rebuilds the clone after the debounce');
assert.equal(cloneOf().querySelectorAll('[data-chat-flow-kind]').length, 4, 'the clone contains the new row');

// --- 6. narrow panes hide the minimap instead of covering text ----------------
scroller.clientWidth = 900;
scroller.offsetWidth = 914;
fireResize();
await sleep(RESIZE_WAIT);
assert.equal(overlayNode.getAttribute('data-visible'), null, 'minimap hides when the pane cannot hold it');

scroller.clientWidth = 1776;
scroller.offsetWidth = 1790;
fireResize();
await sleep(RESIZE_WAIT);
assert.notEqual(overlayNode.getAttribute('data-visible'), null, 'minimap comes back with the pane');

// --- 7. disposal restores the stock UI ----------------------------------------
dispose();
assert.equal(documentStub.querySelectorAll('style[data-plugin-css="dsh-vscode-scrollbar/VscodeScrollbar.css"]').length, 0, 'stylesheet removed');
assert.equal(markers().length, 0, 'tags removed');
assert.equal(overlay(), null, 'overlay removed');
assert.equal(mutationObservers.size, 0, 'mutation observers disconnected');
assert.equal(resizeObservers.size, 0, 'resize observers disconnected');
const remainingWindowListeners = Array.from(windowListeners.values()).reduce((total, handlers) => total + handlers.size, 0);
assert.equal(remainingWindowListeners, 0, 'window listeners removed');
assert.equal(documentStub.body.children.length, 1, 'body keeps only the app content');

console.log('dsh-vscode-scrollbar: client harness passed (scrollbar + minimap v1.1.2, column fit, slider, drag, retag, disposal)');
