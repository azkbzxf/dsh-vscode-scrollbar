/**
 * VS Code scrollbar — gives the conversation column the Visual Studio Code
 * editor's right-hand chrome: a 14px always-visible scrollbar plus the minimap,
 * a narrow preview column that shows the whole conversation scaled down, with a
 * translucent viewport slider you can click or drag to navigate.
 *
 * Neither the scroll container nor the message column ships a stable class name
 * (they are CSS-module hashes such as `_727C8a_scrollBody`), but the slot anchor
 * does: every conversation body renders as a `[data-slot="conversation.session"]`
 * element. This module walks up from that anchor to the nearest scrollable
 * ancestor, tags it, and scopes both effects to the tag. The minimap clones the
 * anchor's subtree into a fixed preview layer: the clone keeps the app's own
 * classes, so it renders with the real markup and theme colors; only its
 * geometry is ours.
 *
 * Styles, tags and the preview layer live only while the plugin is active:
 * disposal removes the sheet, the tags, the preview and every observer, so
 * disabling the plugin restores the stock UI without a reload.
 */
window.__ModuleLoader__.load({
  id: 'dsh-vscode-scrollbar',
  factory() {
    const MARKER = 'data-dsh-vscode-scrollbar';
    const HOST_SELECTOR = '[data-slot="conversation.session"]';
    const STYLE_ID = 'dsh-vscode-scrollbar/VscodeScrollbar.css';
    const SCAN_DELAY_MS = 120;
    const SCROLL_TARGETS = new Set(['auto', 'scroll', 'overlay']);

    // Minimap geometry, close enough to VS Code's editor.minimap defaults to
    // read as the same object: ~80px wide, flush against the scrollbar, dimmed
    // glyphs, and a viewport slider.
    const MM = 'data-dsh-vscode-minimap';
    const MM_PREVIEW = 'data-dsh-vscode-minimap-preview';
    const MM_CLONE = 'data-dsh-vscode-minimap-clone';
    const MM_SLIDER = 'data-dsh-vscode-minimap-slider';
    const MM_VISIBLE = 'data-visible';
    const MM_WIDTH = 80;
    const MM_GAP = 6;
    // A chat column is capped at 920px and centred, so the minimap only appears
    // when the surrounding pane is wide enough to hold it in the empty margin.
    // On narrower windows it hides instead of covering message text.
    const MM_MIN_SCROLLER_WIDTH = 1180;
    const MM_SYNC_DELAY_MS = 350;
    const MM_RESIZE_DELAY_MS = 80;
    const MM_FLOW_PROBE = '[data-chat-flow-kind]';
    // Rows that are outside the conversation's rendering window are hidden and
    // measure 0, so walk far enough to reach a rendered one.
    const MM_COLUMN_SCAN_LIMIT = 400;
    const MM_MIN_COLUMN_WIDTH = 160;
    // Media stays in the clone: images are the biggest part of a chat's height,
    // and dropping them would make the preview shorter than the conversation and
    // put the slider out of step with the editor viewport. Buttons stay too —
    // cloned nodes carry no listeners, and DSH wraps image attachments in them.
    const MM_REMOVE_TAGS = new Set([
      'audio', 'canvas', 'dialog', 'embed', 'form', 'iframe',
      'input', 'object', 'option', 'select', 'svg', 'textarea', 'video',
    ]);

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
      'html body [' + MM + ']{position:fixed;z-index:30;display:none;overflow:hidden;pointer-events:auto;background:transparent}',
      'html body [' + MM + '][' + MM_VISIBLE + ']{display:block}',
      'html body [' + MM_PREVIEW + ']{position:absolute;inset:0;overflow:hidden;opacity:.45;pointer-events:none;transition:opacity .16s ease}',
      'html body [' + MM + ']:hover [' + MM_PREVIEW + ']{opacity:.85}',
      'html body [' + MM_CLONE + ']{position:absolute;top:0;left:0;transform-origin:top left;pointer-events:none;user-select:none;will-change:transform}',
      'html body [' + MM_CLONE + '] *{pointer-events:none!important;animation:none!important;transition:none!important}',
      'html body [' + MM_CLONE + ']::-webkit-scrollbar,html body [' + MM_CLONE + '] *::-webkit-scrollbar{width:0;height:0;display:none}',
      'html body [' + MM_SLIDER + ']{position:absolute;left:0;right:0;top:0;height:0;pointer-events:none;background:rgba(121,121,121,.16)}',
      'html body[data-ds-dark-theme] [' + MM_SLIDER + ']{background:rgba(191,191,191,.14)}',
      'html body [' + MM + ']:hover [' + MM_SLIDER + ']{background:rgba(121,121,121,.3)}',
      'html body[data-ds-dark-theme] [' + MM + ']:hover [' + MM_SLIDER + ']{background:rgba(191,191,191,.26)}',
    ].join('\n');

    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? (callback) => window.requestAnimationFrame(callback)
      : (callback) => window.setTimeout(callback, 16);
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? (id) => window.cancelAnimationFrame(id)
      : (id) => window.clearTimeout(id);

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

    // --------------------------------------------------------------- minimap --
    //
    // One preview layer is shared by every conversation view in the page: at any
    // time it mirrors the widest visible `.conversation.session` because that is
    // the pane the reader is looking at. `mm` holds the live state.

    const mm = {
      overlay: null,
      preview: null,
      slider: null,
      scroller: null,
      anchor: null,
      bindCleanups: [],
      globalCleanups: [],
      syncTimer: 0,
      frame: 0,
      drag: null,
      metrics: { minimapHeight: 0, viewportHeight: 0, scrollHeight: 0, scaleX: 0, scaleY: 0, thumbHeight: 0 },
    };

    function mmCreate(name) {
      const element = document.createElement('div');
      element.setAttribute(name, '');
      return element;
    }

    /** Create the fixed preview layer and its global listeners exactly once. */
    function mmEnsureNodes() {
      if (mm.overlay !== null) return;
      if (document.body === null) return;
      const overlay = mmCreate(MM);
      overlay.setAttribute('aria-hidden', 'true');
      const preview = mmCreate(MM_PREVIEW);
      const slider = mmCreate(MM_SLIDER);
      overlay.appendChild(preview);
      overlay.appendChild(slider);
      document.body.appendChild(overlay);
      mm.overlay = overlay;
      mm.preview = preview;
      mm.slider = slider;
      overlay.addEventListener('mousedown', mmPointerDown);

      const onMove = (event) => mmPointerMove(event);
      const onUp = () => mmPointerUp();
      const onResize = () => mmSchedule(MM_RESIZE_DELAY_MS);
      if (typeof window.addEventListener === 'function') {
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        window.addEventListener('resize', onResize);
      }
      mm.globalCleanups.push(() => {
        if (typeof window.removeEventListener === 'function') {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
          window.removeEventListener('resize', onResize);
        }
      });
    }

    /**
     * Drop the parts of the clone that would be expensive, focusable or
     * otherwise stateful, and every `id`, so the clone never duplicates document
     * ids, starts playing media a second time, or steals focus. Event listeners
     * are not cloned, so ordinary nodes (including wrapper buttons) stay inert.
     */
    function mmSanitize(clone) {
      const stack = Array.from(clone.children);
      while (stack.length > 0) {
        const element = stack.pop();
        if (element.hasAttribute('id')) element.removeAttribute('id');
        const tag = typeof element.tagName === 'string' ? element.tagName.toLowerCase() : '';
        if (MM_REMOVE_TAGS.has(tag)) {
          element.remove();
          continue;
        }
        for (const child of Array.from(element.children)) stack.push(child);
      }
    }

    /**
     * The chat column is capped at `max-width: var(--dsh-chat-content-width)` and
     * centred, and every message row is a `[data-chat-flow-kind]` flex child of
     * it, so a rendered row reports the column width exactly. Rows outside the
     * rendering window are hidden (width 0), which is why the scan is generous.
     * The column is measured on the live tree: the clone is detached from the
     * ancestors that publish that CSS variable, so its own rows would reflow to
     * the full pane width.
     */
    function mmMeasureColumn(anchor, anchorWidth) {
      const rows = anchor.querySelectorAll(MM_FLOW_PROBE);
      const limit = Math.min(rows.length, MM_COLUMN_SCAN_LIMIT);
      for (let index = 0; index < limit; index += 1) {
        const rect = rows[index].getBoundingClientRect();
        const rowWidth = rect.width || 0;
        if (rowWidth < MM_MIN_COLUMN_WIDTH || rowWidth > anchorWidth) continue;
        // The column is centred in a symmetrically padded pane.
        return { left: Math.max(0, (anchorWidth - rowWidth) / 2), width: rowWidth };
      }
      return { left: 0, width: anchorWidth };
    }

    /** Rebuild the clone from the current conversation and re-measure geometry. */
    function mmSync() {
      const scroller = mm.scroller;
      const anchor = mm.anchor;
      if (scroller === null || anchor === null) return;
      mmEnsureNodes();
      if (mm.overlay === null) return;

      const scrollerRect = scroller.getBoundingClientRect();
      const scrollbarWidth = Math.max(0, (scroller.offsetWidth || 0) - (scroller.clientWidth || 0));
      const minimapHeight = Math.max(1, scroller.clientHeight || 0);
      const width = Math.min(MM_WIDTH, Math.max(0, (scroller.clientWidth || 0) - MM_GAP * 2));
      mm.overlay.style.left = Math.round((scrollerRect.right || 0) - scrollbarWidth - MM_GAP - width) + 'px';
      mm.overlay.style.top = Math.round(scrollerRect.top || 0) + 'px';
      mm.overlay.style.width = Math.round(width) + 'px';
      mm.overlay.style.height = Math.round(minimapHeight) + 'px';

      const anchorRect = anchor.getBoundingClientRect();
      // Slot anchors render with `display: contents`: the outlet wrapper takes
      // no layout box, so the anchor itself has no size. Fall back to the pane's
      // content box and measure the chat column from the pane's left edge.
      const anchorBoxWidth = anchorRect.width || 0;
      const anchorWidth = Math.max(1, anchorBoxWidth > 1 ? anchorBoxWidth : (scroller.clientWidth || 1));
      const scrollHeight = Math.max(1, scroller.scrollHeight || 0);
      const viewportHeight = minimapHeight;
      const wide = (scroller.clientWidth || 0) >= MM_MIN_SCROLLER_WIDTH;
      const scrollable = scrollHeight > viewportHeight + 4;
      if (!wide || !scrollable || width < 32) {
        mm.metrics = { minimapHeight, viewportHeight, scrollHeight, scaleX: 0, scaleY: 0, thumbHeight: 0 };
        mm.overlay.removeAttribute(MM_VISIBLE);
        return;
      }
      mm.overlay.setAttribute(MM_VISIBLE, '');

      const column = mmMeasureColumn(anchor, anchorWidth);
      const clone = anchor.cloneNode(true);
      mmSanitize(clone);
      clone.setAttribute(MM_CLONE, '');
      // The anchor's inline `display: contents` comes along with cloneNode; give
      // the clone a real box or the width and scale below would be inert and its
      // children would reflow inside the 80px preview instead of shrinking.
      clone.style.display = 'block';
      clone.style.width = Math.round(anchorWidth) + 'px';
      // The clone sits outside the conversation body that publishes
      // `--dsh-chat-content-width`, so hand it the measured column width: without
      // it every row reflows to the pane width and the preview shows a full-width
      // blur instead of the centred column.
      clone.style.setProperty('--dsh-chat-content-width', Math.round(column.width) + 'px');
      // Append the untransformed clone first: natural height is a layout number,
      // and getBoundingClientRect only reports it before the transform is applied.
      mm.preview.replaceChildren(clone);
      const naturalHeight = Math.max(1, clone.offsetHeight || 0);
      // VS Code fits the whole document into the minimap: scale the rows so the
      // preview always fills the pane, then the slider reports where the viewport
      // sits. Scale, then shift the measured column to x = 0; CSS applies the
      // function list right to left, so x' = scaleX * (x - column.left).
      const scaleX = width / Math.max(1, column.width);
      const scaleY = minimapHeight / naturalHeight;
      clone.style.transform =
        'scale(' + scaleX.toFixed(5) + ',' + scaleY.toFixed(5) + ') translate(' + (-column.left).toFixed(2) + 'px,0px)';

      // The slider mirrors the scroller's own scrollbar: thumb = viewport
      // fraction of the content, position = fraction of the scrollable range.
      // Deriving it from the fitted clone would desynchronise it from the pane.
      const thumbHeight = Math.max(8, Math.round(minimapHeight * viewportHeight / scrollHeight));
      mm.metrics = {
        minimapHeight, viewportHeight, scrollHeight, scaleX, scaleY, thumbHeight,
        naturalHeight, columnWidth: column.width, columnLeft: column.left,
      };
      mmSyncSlider();
    }

    /** Position the viewport slider with the scroller's own scrollbar ratio. */
    function mmSyncSlider() {
      if (mm.scroller === null || mm.slider === null) return;
      const { minimapHeight, viewportHeight, scrollHeight, thumbHeight } = mm.metrics;
      if (minimapHeight <= 0 || thumbHeight <= 0) return;
      const maxScroll = Math.max(1, scrollHeight - viewportHeight);
      const ratio = Math.min(1, Math.max(0, (mm.scroller.scrollTop || 0) / maxScroll));
      const travel = Math.max(0, minimapHeight - thumbHeight);
      mm.slider.style.height = thumbHeight + 'px';
      mm.slider.style.top = Math.round(ratio * travel) + 'px';
    }

    function mmOnScroll() {
      if (mm.frame !== 0) return;
      mm.frame = scheduleFrame(() => {
        mm.frame = 0;
        if (mm.overlay !== null && mm.overlay.hasAttribute(MM_VISIBLE)) mmSyncSlider();
      });
    }

    /** Map a y coordinate inside the overlay to the conversation's scrollTop. */
    function mmScrollToPointer(y) {
      const scroller = mm.scroller;
      if (scroller === null) return;
      const { minimapHeight, viewportHeight, scrollHeight, thumbHeight } = mm.metrics;
      if (minimapHeight <= 0 || thumbHeight <= 0) return;
      const travel = Math.max(1, minimapHeight - thumbHeight);
      // Centre the slider on the pointer, clamped to the track, then invert the
      // same ratio the scroller's own scrollbar uses.
      const ratio = Math.min(1, Math.max(0, (y - thumbHeight / 2) / travel));
      const maxScroll = Math.max(0, scrollHeight - viewportHeight);
      scroller.scrollTop = Math.round(ratio * maxScroll);
    }

    function mmPointerDown(event) {
      if (mm.scroller === null || mm.overlay === null || mm.slider === null) return;
      if (mm.metrics.thumbHeight <= 0) return;
      if (typeof event.button === 'number' && event.button !== 0) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const overlayRect = mm.overlay.getBoundingClientRect();
      const y = (event.clientY || 0) - (overlayRect.top || 0);
      const sliderTop = parseFloat(mm.slider.style.top) || 0;
      const sliderHeight = parseFloat(mm.slider.style.height) || 0;
      const onSlider = y >= sliderTop && y <= sliderTop + sliderHeight;
      mm.drag = onSlider ? { startY: event.clientY || 0, startScroll: mm.scroller.scrollTop || 0 } : null;
      if (!onSlider) mmScrollToPointer(y);
      mmSyncSlider();
    }

    function mmPointerMove(event) {
      if (mm.drag === null || mm.scroller === null) return;
      const { minimapHeight, viewportHeight, scrollHeight, thumbHeight } = mm.metrics;
      const travel = Math.max(1, minimapHeight - thumbHeight);
      const maxScroll = Math.max(0, scrollHeight - viewportHeight);
      if (maxScroll === 0) return;
      const startRatio = Math.min(1, Math.max(0, mm.drag.startScroll / maxScroll));
      const ratio = Math.min(1, Math.max(0, startRatio + ((event.clientY || 0) - mm.drag.startY) / travel));
      mm.scroller.scrollTop = Math.round(ratio * maxScroll);
      mmSyncSlider();
    }

    function mmPointerUp() {
      mm.drag = null;
    }

    function mmSchedule(delay) {
      if (mm.syncTimer !== 0) return;
      mm.syncTimer = window.setTimeout(() => {
        mm.syncTimer = 0;
        mmSync();
      }, delay);
    }

    function mmBind(scroller, anchor) {
      if (mm.scroller === scroller && mm.anchor === anchor) return;
      mmUnbind();
      mm.scroller = scroller;
      mm.anchor = anchor;
      const cleanups = [];
      const onScroll = () => mmOnScroll();
      scroller.addEventListener('scroll', onScroll, { passive: true });
      cleanups.push(() => scroller.removeEventListener('scroll', onScroll));
      if (typeof window.ResizeObserver === 'function') {
        const observer = new window.ResizeObserver(() => mmSchedule(MM_RESIZE_DELAY_MS));
        observer.observe(scroller);
        cleanups.push(() => observer.disconnect());
      }
      if (typeof window.MutationObserver === 'function') {
        // Trailing debounce: content only changes between generations, so a
        // streaming answer refreshes the preview once it pauses instead of
        // cloning the conversation on every token.
        const observer = new window.MutationObserver(() => {
          mmSchedule(MM_SYNC_DELAY_MS);
        });
        observer.observe(anchor, { childList: true, subtree: true, characterData: true });
        cleanups.push(() => observer.disconnect());
      }
      mm.bindCleanups = cleanups;
      mmSync();
    }

    function mmUnbind() {
      for (const cleanup of mm.bindCleanups.splice(0)) cleanup();
      if (mm.syncTimer !== 0) {
        window.clearTimeout(mm.syncTimer);
        mm.syncTimer = 0;
      }
      if (mm.frame !== 0) {
        cancelFrame(mm.frame);
        mm.frame = 0;
      }
      mm.drag = null;
      mm.scroller = null;
      mm.anchor = null;
      if (mm.overlay !== null) mm.overlay.removeAttribute(MM_VISIBLE);
    }

    function mmDispose() {
      mmUnbind();
      for (const cleanup of mm.globalCleanups.splice(0)) cleanup();
      if (mm.overlay !== null) mm.overlay.remove();
      mm.overlay = null;
      mm.preview = null;
      mm.slider = null;
    }

    // ------------------------------------------------------------------ scan --

    /**
     * Tag every conversation scroller, and point the minimap at the widest one.
     * Returns the number of newly tagged containers.
     */
    function scanConversations() {
      let count = 0;
      let primary = null;
      for (const anchor of document.querySelectorAll(HOST_SELECTOR)) {
        const scroller = findScroller(anchor);
        if (scroller === null) continue;
        if (!scroller.hasAttribute(MARKER)) {
          scroller.setAttribute(MARKER, '');
          count += 1;
        }
        if (primary === null || (scroller.clientWidth || 0) > (primary.scroller.clientWidth || 0)) {
          primary = { scroller, anchor };
        }
      }
      if (primary === null) mmUnbind();
      else mmBind(primary.scroller, primary.anchor);
      return count;
    }

    /**
     * Attach styles, tag the current conversation and follow later renders.
     * Returns the disposal that restores the stock UI.
     */
    function activate() {
      const tag = attachStyles();
      scanConversations();

      // Rows stream in token by token, sessions switch, split views open: a
      // mutation burst re-scans at most once per SCAN_DELAY_MS, which keeps the
      // work proportional to "a conversation changed", not "a token arrived".
      let timer = 0;
      const scan = () => {
        timer = 0;
        scanConversations();
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
        mmDispose();
        for (const marked of document.querySelectorAll('[' + MARKER + ']')) marked.removeAttribute(MARKER);
        if (tag !== null) tag.remove();
      };
    }

    return {
      apply(ctx) {
        ctx.effect(() => activate(), 'dsh-vscode-scrollbar: conversation scrollbar and minimap');
      },
    };
  },
});
