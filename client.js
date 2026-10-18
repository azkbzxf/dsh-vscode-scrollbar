/**
 * VS Code scrollbar — swaps the conversation scrollbar for the Visual Studio
 * Code editor scrollbar: a 14px always-visible bar with a flat, translucent
 * thumb that darkens on hover and lightens while dragging.
 *
 * The conversation scroll container has no stable class name (its classes are
 * CSS-module hashes), but the slot anchor does: every conversation body renders
 * as a `[data-slot="conversation.session"]` element, and the scroll container is
 * the nearest scrollable ancestor of that anchor. This module walks that chain
 * when the slot mounts, tags the container with `data-dsh-vscode-scrollbar`,
 * and re-tags after route or session changes; the stylesheet targets the tag.
 *
 * Styles are attached while the plugin is active and removed on disposal, so
 * disabling the plugin restores the stock scrollbar without a reload.
 */
window.__ModuleLoader__.load({
  id: 'dsh-vscode-scrollbar',
  factory() {
    const MARKER = 'data-dsh-vscode-scrollbar';
    const HOST_SELECTOR = '[data-slot="conversation.session"]';
    const STYLE_ID = 'dsh-vscode-scrollbar/VscodeScrollbar.css';
    const SCAN_DELAY_MS = 120;
    const SCROLL_TARGETS = new Set(['auto', 'scroll', 'overlay']);

    // The marker is the primary hook; the `:has()` branch additionally lets the
    // sheet work on a container whose anchor is its direct child even when the
    // marker has not been applied yet (or a future shell drops the attribute).
    const target = ':is([' + MARKER + '], :has(> ' + HOST_SELECTOR + '))';

    // VS Code's own scrollbar defaults:
    //   size      14px (editor.scrollbar.verticalScrollbarSize)
    //   light     slider #64646466, hover #646464B3, active #BFBFBF66
    //   dark      slider #79797966, hover #646464B3, active #BFBFBF66
    //   track     transparent, no buttons, no rounding
    // `body[data-ds-dark-theme]` is how the theme service marks the resolved
    // dark palette, so these values follow the active theme exactly like VS Code.
    const css = [
      'html body ' + target + '{--dsh-vscode-scrollbar-size:14px;--dsh-vscode-scrollbar-thumb:rgba(100,100,100,.4);--dsh-vscode-scrollbar-thumb-hover:rgba(100,100,100,.7);--dsh-vscode-scrollbar-thumb-active:rgba(191,191,191,.4)}',
      'html body[data-ds-dark-theme] ' + target + '{--dsh-vscode-scrollbar-thumb:rgba(121,121,121,.4);--dsh-vscode-scrollbar-thumb-hover:rgba(100,100,100,.7);--dsh-vscode-scrollbar-thumb-active:rgba(191,191,191,.4)}',
      'html body ' + target + '::-webkit-scrollbar{width:var(--dsh-vscode-scrollbar-size);height:var(--dsh-vscode-scrollbar-size);background:transparent}',
      'html body ' + target + '::-webkit-scrollbar-track{margin:0;border:0;background:transparent}',
      'html body ' + target + '::-webkit-scrollbar-thumb{min-width:0;min-height:0;border:0;border-radius:0;background-color:var(--dsh-vscode-scrollbar-thumb);background-clip:border-box;background-image:none;box-shadow:none}',
      'html body ' + target + '::-webkit-scrollbar-thumb:hover{background-color:var(--dsh-vscode-scrollbar-thumb-hover)}',
      'html body ' + target + '::-webkit-scrollbar-thumb:active{background-color:var(--dsh-vscode-scrollbar-thumb-active)}',
      'html body ' + target + '::-webkit-scrollbar-corner{background:transparent}',
    ].join('\n');

    /** Attach the sheet once; returns the tag so disposal can take it back. */
    function attachStyles() {
      const existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_ID) + ']');
      if (existing !== null) return null;
      const tag = document.createElement('style');
      // `data-plugin` marks the tag as owned by this module: the loader claims,
      // inventories and removes package styles together with the plugin.
      tag.dataset.plugin = 'dsh-vscode-scrollbar';
      tag.dataset.pluginCss = STYLE_ID;
      tag.textContent = css;
      document.head.appendChild(tag);
      return tag;
    }

    /** The nearest ancestor of `anchor` that actually scrolls. */
    function findScroller(anchor) {
      let element = anchor.parentElement;
      while (element !== null && element !== document.documentElement) {
        const { overflowY } = window.getComputedStyle(element);
        if (SCROLL_TARGETS.has(overflowY)) return element;
        element = element.parentElement;
      }
      return null;
    }

    /** Tag every conversation scroller that is not tagged yet. */
    function markConversationScrollers() {
      let count = 0;
      for (const anchor of document.querySelectorAll(HOST_SELECTOR)) {
        const scroller = findScroller(anchor);
        if (scroller === null || scroller.hasAttribute(MARKER)) continue;
        scroller.setAttribute(MARKER, '');
        count += 1;
      }
      return count;
    }

    /**
     * Attach styles, tag the current conversation and follow later renders.
     * Returns the disposal that restores the stock scrollbar.
     */
    function activate() {
      const tag = attachStyles();
      markConversationScrollers();

      // Rows stream in token by token, sessions switch, split views open: a
      // mutation burst re-scans at most once per SCAN_DELAY_MS, which keeps the
      // work proportional to "a conversation changed", not "a token arrived".
      let timer = 0;
      const scan = () => {
        timer = 0;
        markConversationScrollers();
      };
      const scheduleScan = () => {
        if (timer !== 0) return;
        timer = window.setTimeout(scan, SCAN_DELAY_MS);
      };

      const observer = typeof window.MutationObserver === 'function' ? new window.MutationObserver(scheduleScan) : null;
      const observed = document.body === null ? document.documentElement : document.body;
      if (observer !== null && observed !== null) observer.observe(observed, { childList: true, subtree: true });

      return () => {
        if (observer !== null) observer.disconnect();
        if (timer !== 0) {
          window.clearTimeout(timer);
          timer = 0;
        }
        for (const marked of document.querySelectorAll('[' + MARKER + ']')) marked.removeAttribute(MARKER);
        if (tag !== null) tag.remove();
      };
    }

    return {
      apply(ctx) {
        ctx.effect(() => activate(), 'dsh-vscode-scrollbar: conversation scrollbar');
      },
    };
  },
});
