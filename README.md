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
| Viewport slider | none | translucent block mapped through the preview scale |
| Checkpoint rail | right-aligned at the edge, hidden under the preview | parked 110px from the right edge, left of the column and fully visible |
| Click | n/a | jumps the conversation to that point |
| Drag | n/a | scrubs the conversation |
| Idle / hover opacity | n/a | 45% / 85% |
| Minimum pane width | n/a | 1180px — below that the column hides instead of covering text |

## Behaviour

- The minimap only appears when there is spare room. The chat column is capped at 920px, so on wide
  windows the preview sits in the empty right margin; on a narrow window it hides rather than covering
  the messages. It also stays hidden while the conversation is shorter than the viewport.
- The slider is a position overlay, not a scrollbar look-alike: its height is the viewport height
  through the preview scale and its offset is `scrollTop` through the same scale, so it lands on the
  preview line the viewport is showing. Drag it to scrub; click anywhere else in the preview to jump
  there. It deliberately does not copy the native scrollbar thumb's size.
- Harness's turn-navigation rail (the short checkpoint bars on the right edge) keeps its stock position
  until the preview appears, then moves out of the column's way and stays clickable.
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
   the container's top and height. It is `z-index:30`, read-only and never takes layout space. While it
   is shown, a stylesheet rule parks Harness's turn-navigation rail (`nav[aria-label="轮次导航"]`) at
   `right:110px`, i.e. 14px bar + 6px gap + 80px column + 10px breathing room, so the rail's checkpoint
   bars are no longer painted over; with the column hidden the rail returns to its stock `right:12px`.
2. The chat column is measured on the **live** tree: every message row is a `[data-chat-flow-kind]`
   flex child of a column capped at `max-width: var(--dsh-chat-content-width)` and centred, so a
   rendered row reports the column width exactly. Measuring the clone instead would be wrong — the
   clone is detached from the ancestors that publish that CSS variable, so its rows reflow to the
   full pane width.
3. The anchor is cloned, sanitized in one tree walk, and given its own layout box: slot anchors render
   with `display: contents` (the outlet wrapper takes no box), so the clone is forced to
   `display: block`, sized from the pane's content width, and handed the measured column width as
   `--dsh-chat-content-width`. It is appended untransformed first, because the natural height is what
   the preview is fitted to.
4. The clone is transformed with `scale(sx, sy) translate(-columnLeft, 0)`: `sx = 80px / columnWidth`
   and `sy = paneHeight / naturalHeight`, so the preview always fills the pane the way VS Code's
   minimap fits a file into its column.
5. The slider lives in the preview's own coordinate system, not the scrollbar's: its height is
   `viewportHeight * scaleY` and its top is `scrollTop * scaleY`, clamped to the track, so it always
   marks the viewport the preview is showing. The same scale inverts pointer positions: a click maps
   `y / scaleY - viewportHeight / 2` back to `scrollTop`, and a drag adds `deltaY / scaleY`. Keeping the
   mapping in preview coordinates means the slider stays aligned while the clone is still growing and
   never has to imitate the native thumb's size.
6. A `MutationObserver` on the anchor rebuilds the clone (trailing 350 ms debounce), a
   `ResizeObserver` plus a window resize listener re-measure the column and pane, and scroll events
   schedule a rAF-throttled slider update.
7. A body `MutationObserver` re-tags columns when the conversation re-renders, sessions switch, or a
   split view opens; scans are coalesced to at most one per 120 ms so streaming stays cheap.
8. Everything hangs off the plugin effect: the stylesheet, layer, markers, observers and listeners are
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

- **1.1.3** — the minimap no longer hides Harness's turn-navigation rail: while the column is shown the
  rail is parked 110px from the right edge, clear of the preview and still clickable. The slider is now
  a pure position overlay — height `viewportHeight * scaleY`, offset `scrollTop * scaleY` — so it marks
  the preview line being viewed instead of imitating the native scrollbar thumb's size.
- **1.1.2** — fixes the minimap against the real conversation: the chat column is measured from the
  live `[data-chat-flow-kind]` rows (a detached clone reflows to the full pane), images stay in the
  preview so its height matches the conversation, the preview is fitted to the pane, and the slider
  now uses the scroll container's own viewport/scroll ratio, so it tracks the 14px scrollbar exactly.
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
left alone; the minimap measures the chat column from the live message rows, reproduces it on the
clone, fills the pane, and maps the slider through the preview scale; scrolling moves only
the slider; a click maps back to `scrollTop`; dragging the thumb scrolls proportionally; the preview
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
- The clone keeps images and message structure but drops stateful media — SVG, canvas, video, audio,
  forms and editors stay out — and events are not cloned, so the preview is inert and cheap.
- Below 1180px of pane width the minimap hides instead of overlapping messages.
- If a future Harness build drops the `data-slot="conversation.session"` contract and renames the
  scroll container, the plugin stops applying (it does not break anything); the fix is a selector
  update.

## License

MIT
