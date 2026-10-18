# dsh-vscode-scrollbar

A DSH (DeepSeek Harness) plugin that restyles the conversation scrollbar to look and behave like the
**Visual Studio Code** editor scrollbar: a 14px always-visible bar with a flat, translucent thumb that
darkens on hover and lightens while you drag it.

The stock Harness scrollbar is a 5px, rounded, overlay-style bar. This plugin changes only the
conversation's scroll column — every other scrollbar in the app (menus, code blocks, sidebars, the
composer) keeps the stock look.

## What changes

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
Client half hot-loads into the open page. Replacing an already-installed copy needs a DSH restart for
the fresh client build.

Remove it again with:

```sh
dsh plugin --profile <profile> remove dsh-vscode-scrollbar
```

## How it works

The conversation scroll container ships no stable class name — its classes are CSS-module hashes
(`_727C8a_scrollBody`) that change between builds. It does ship a stable DOM contract, though: every
conversation body renders as a `[data-slot="conversation.session"]` element, and the shared shell
itself styles that relationship (its composer-overlay rules already use
`[data-slot="conversation.session"]`). This plugin therefore:

1. finds each `[data-slot="conversation.session"]` anchor,
2. walks up to the nearest ancestor whose computed `overflow-y` is `auto`/`scroll` — that is the chat
   scroll container,
3. tags it with `data-dsh-vscode-scrollbar`, and
4. lets a scoped stylesheet own `::-webkit-scrollbar*` for the tagged element only.

A `MutationObserver` re-tags when the conversation re-renders, when sessions switch, or when a split
view opens; scans are coalesced to at most one per 120 ms so token-by-token streaming stays cheap.
The stylesheet is attached on activation and removed on disposal, so disabling the plugin restores
the stock scrollbar without a reload.

The stylesheet also carries a `:has(> [data-slot="conversation.session"])` selector branch, so the
bar renders correctly even before the marker is applied.

## Configuration

No settings are required. The four values are exposed as CSS custom properties on the tagged
container, so a theme plugin or a user stylesheet can tune them without forking this package:

```css
--dsh-vscode-scrollbar-size          /* track width/height, default 14px */
--dsh-vscode-scrollbar-thumb         /* idle thumb color  */
--dsh-vscode-scrollbar-thumb-hover   /* hovered thumb color */
--dsh-vscode-scrollbar-thumb-active  /* dragged thumb color */
```

## Compatibility

- Verified against DSH Desktop **2.0.18** (client `0.2.1-rc.2`, Electron 44 / Chromium).
- Uses only the browser's `::-webkit-scrollbar` machinery plus one `MutationObserver` — no imports of
  Harness Client packages, no React tree edits, no DOM of other plugins.
- Chromium-based targets only. Browsers without `::-webkit-scrollbar` (Firefox, Safari) keep the
  platform scrollbar; the plugin does not crash there, it simply has no effect.

## Development

Files:

```
client.js         Client half: tagging + stylesheet
index.js          Host half (empty apply — the plugin is pure Client CSS)
cordis.patch.yml  composition row
locale/en.json    plugin title/description shown by the plugin manager
locale/zh.json
icon.svg          plugin icon
test/harness.mjs  offline harness for the tagging logic
```

Run the harness (needs only Node — no browser, no install):

```sh
node test/harness.mjs client.js
```

It asserts that the stylesheet is attached once, that the nearest scrollable ancestor of a
conversation anchor is tagged, that a non-scrollable ancestor and a `overflow:hidden` wrapper are
left alone, that a re-rendered conversation is re-tagged after a mutation, and that disposal removes
the marker, the stylesheet and the observer.

Package for a release tarball:

```sh
npm pack
```

## Known limitations

- Only the conversation scroll column is restyled; code blocks and menus keep the stock thin bar
  (deliberate — a 14px bar inside a code block would be noise).
- A conversation view rendered by another plugin outside a `conversation.session` anchor keeps the
  stock bar.
- If a future Harness build drops the `data-slot="conversation.session"` contract and renames the
  scroll container, the CSS stops applying (it does not break anything); the fix is a selector update.

## License

MIT
