# dsh-vscode-scrollbar

A DSH (DeepSeek Harness) plugin that gives the conversation the **Visual Studio Code** editor chrome:

- the **VS Code scrollbar** — a 14px always-visible bar with a flat, translucent thumb that darkens on
  hover and lightens while you drag it, and
- the **VS Code minimap** — a scaled-down preview column on the right that shows the whole
  conversation, with a viewport slider you can drag or click to navigate.

The stock Harness scrollbar is a 5px, rounded, overlay-style bar and the conversation has no minimap
at all. This plugin changes only the conversation's scroll column; every other scrollbar in the app
(menus, code blocks, sidebars, the composer) keeps the stock look.

## What changes

**Scrollbar**

| Property | Harness default | With this plugin |
| --- | --- | --- |
| Track width | 5px | 14px |
| Track background | transparent | transparent |
| Thumb shape | pill (`border-radius:999px`, inset border) | flat rectangle, no radius |
| Thumb — light theme | theme scrollbar alias | `rgba(100,100,100,.4)` (`#64646466`) |
| Thumb — dark theme | theme scrollbar alias | `rgba(121,121,121,.4)` (`#79797966`) |
| Hover | theme scrollbar alias | `rgba(100,100,100,.7)` (`#646464B3`) |
| Dragging (active) | theme scrollbar alias | `rgba(191,191,191,.4)` (`#BFBFBF66`) |
| Scrollbar buttons | none | none |

These are VS Code's own defaults (`scrollbarSlider.*` in its light and dark themes;
`editor.scrollbar.verticalScrollbarSize` = 14). Dark mode is read from the
`body[data-ds-dark-theme]` attribute that the Harness theme service sets, so the colors follow the
active palette exactly like VS Code does — no plugin-wide color override, no second theme system.

**Minimap**

| Property | Harness default | With this plugin |
| --- | --- | --- |
| Preview column | none | 80px column right of the scrollbar, 6px gap |
| Content | none | snapshot of the whole conversation, scaled into the column |
| Viewport slider | none | translucent block sized to the visible fraction |
| Click | n/a | jumps the conversation to that point |
| Drag | n/a | scrubs the conversation |
| Idle / hover opacity | n/a | 45% / 85% |
| Minimum pane width | n/a | 1180px — below that the column hides instead of covering text |

## Behaviour

- The minimap only appears when there is spare room. The chat column is capped at 920px, so on wide
  windows the preview sits in the empty right margin; on a narrow window it hides rather than covering
  the messages. It also stays hidden while the conversation is shorter than the viewport.
- The slider tracks the scroll position and is sized to the visible fraction. Drag it to scrub;
  click anywhere else in the preview to jump there.
- The preview refreshes after new content settles, debounced by 350 ms, so a streaming answer does not
  rebuild the clone on every token. Scrolling is rAF-throttled.
- It is read-only: interactions pass through the preview, and the clone has its ids, images, SVG,
  canvas, video, form controls and running animations removed, so it stays cheap and cannot interfere
  with the real conversation.

## Install / 安装

Install from GitHub into the profile you use:

```sh
dsh plugin --profile <profile> add github:azkbzxf/dsh-vscode-scrollbar
```

Or install a local checkout through the plugin manager tool:

```json
{ "action": "install_bundle", "target": "D:\\path\\to\\dsh-vscode-scrollbar" }
```

A newly added bundle activates on the running instance: the Host row is live immediately and the
Client half hot-loads into the open page. Replacing an already-installed copy needs the page to be
reloaded (or DSH restarted) before the fresh client build is used.

Remove it again with:

```sh
dsh plugin --profile <profile> remove dsh-vscode-scrollbar
```

## How it works

The conversation scroll container ships no stable class name — its classes are CSS-module hashes
(`_727C8a_scrollBody`) that change between builds. It does ship a stable DOM contract, though: every
conversation body renders as a `[data-slot="conversation.session"]` element, and the shared shell
itself styles that relationship (its composer-overlay rules already use
`[data-slot="conversation.session"]`). Both halves start from that anchor.

**Scrollbar**

1. find each `[data-slot="conversation.session"]` anchor,
2. walk up to the nearest ancestor whose computed `overflow-y` is `auto`/`scroll` — that is the chat
   scroll container,
3. tag it with `data-dsh-vscode-scrollbar`, and
4. let a scoped stylesheet own `::-webkit-scrollbar*` for the tagged element only.

The stylesheet also carries a `:has(> [data-slot="conversation.session"])` selector branch, so the
bar renders correctly even before the marker is applied.

**Minimap**

1. A fixed-position layer is appended to `document.body` and placed from the scroll container's
   `getBoundingClientRect()`: to the left of the 14px bar (`right - scrollbarWidth - 6px - 80px`), with
   the container's top and height. It is `z-index:30`, read-only and never takes layout space.
2. The anchor is cloned, sanitized in one tree walk, and transformed with `scale(sx, sy)
   translate(...)`. Slot anchors render with `display: contents` (the outlet wrapper takes no box), so
   the clone is forced to `display: block`, sized from the pane's content width, and its chat column is
   measured from the pane's left edge. The horizontal scale is the preview width over the *measured chat
   column* width — the widest descendant that is narrower than 95% of the pane — so the preview matches
   what the messages look like, not the empty gutter around them.
3. The vertical scale is uniform until the scaled content is shorter than the preview; then it
   stretches to fill it.
4. The same scale maps `scrollTop` to the slider's top/height and pointer positions back to
   `scrollTop`; slider drags and click-to-jump share one mapping.
5. A `MutationObserver` on the anchor rebuilds the clone (trailing 350 ms debounce), a
   `ResizeObserver` plus a window resize listener re-measure the column and pane, and scroll events
   schedule a rAF-throttled slider update.
6. A body `MutationObserver` re-tags columns when the conversation re-renders, sessions switch, or a
   split view opens; scans are coalesced to at most one per 120 ms so streaming stays cheap.
7. Everything hangs off the plugin effect: the stylesheet, layer, markers, observers and listeners are
   all removed on disposal, so disabling the plugin restores the stock UI without a reload.

## Configuration

No settings are required. The scrollbar values are exposed as CSS custom properties on the tagged
container, so a theme plugin or a user stylesheet can tune them without forking this package:

```css
--dsh-vscode-scrollbar-size          /* track width/height, default 14px */
--dsh-vscode-scrollbar-thumb         /* idle thumb color  */
--dsh-vscode-scrollbar-thumb-hover   /* hovered thumb color */
--dsh-vscode-scrollbar-thumb-active  /* dragged thumb color */
```

Minimap geometry is fixed in 1.1.0 (80px column, 6px gap, 1180px minimum pane width); it has no
settings of its own.

## Compatibility

- Verified against DSH Desktop **2.0.18** (client `0.2.1-rc.2`, Electron 44 / Chromium).
- Uses only `::-webkit-scrollbar`, DOM cloning and the two observers — no imports of Harness Client
  packages, no React tree edits, no DOM of other plugins.
- Chromium-based targets only. Browsers without `::-webkit-scrollbar` (Firefox, Safari) keep the
  platform scrollbar and get no minimap; the plugin does not crash there, it simply has no effect.

## What's new

- **1.1.1** — fixes the minimap layout: slot anchors are `display: contents`, so the preview clone now
  gets its own box instead of reflowing inside the 80px column.
- **1.1.0** — adds the VS Code minimap preview column next to the scrollbar.
- **1.0.0** — VS Code-style conversation scrollbar.

## Development

Files:

```
client.js         Client half: tagging + stylesheet + minimap
index.js          Host half (empty apply — the plugin is pure Client UI)
cordis.patch.yml  composition row
locale/en.json    plugin title/description shown by the plugin manager
locale/zh.json
icon.svg          plugin icon
test/harness.mjs  offline harness for both features
```

Run the harness (needs only Node — no browser, no install):

```sh
node test/harness.mjs client.js
```

It stubs the DOM, layout rectangles and the observers, and asserts: the stylesheet is attached once;
the nearest scrollable ancestor of a conversation anchor is tagged while a non-scrollable wrapper is
left alone; a re-rendered conversation is re-tagged; the minimap measures the chat column, scales the
clone and positions the slider from the scroll position; a click maps back to `scrollTop`; the preview
hides on a narrow pane and returns when widened; conversation mutations rebuild the clone; and
disposal removes the sheet, markers, layer, observers and listeners.

Package for a release tarball:

```sh
npm pack
```

## Known limitations

- Only the conversation scroll column is restyled and previewed; code blocks, menus and sidebars keep
  the stock bar and no minimap. A 14px bar inside a code block would be noise.
- The preview is a snapshot refreshed after 350 ms of quiet, not a live mirror: fast streaming shows up
  in steps rather than continuously.
- Media (images, SVG, canvas, video) is deliberately omitted from the preview, and animations are
  stripped; the preview shows the text-and-diff shape of the conversation, which is what a minimap is
  for (and what keeps it inexpensive).
- Below 1180px of pane width the minimap hides instead of overlapping messages.
- If a future Harness build drops the `data-slot="conversation.session"` contract and renames the
  scroll container, the plugin stops applying (it does not break anything); the fix is a selector
  update.

## License

MIT
