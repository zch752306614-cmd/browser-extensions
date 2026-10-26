/*!
 * TxVideoPauseAdKiller v2.1.0 —— 腾讯视频暂停广告清理
 * 作用域：仅 v.qq.com
 *
 *  ── 本版关键变更（基于真实页面抓取实证）──────────────────
 *  用登录态真实环境触发暂停广告，MutationObserver 抓到实际 DOM：
 *
 *    <div class="creative-player-4-layer">
 *      <div class="txp_full_screen_pause-active" z=1000 铺满播放器>
 *        <div class="txp_full_screen_pause-active-mask">      ← 广告底图
 *        <div class="txp_full_screen_pause-active-content">
 *          …二维码 / 文案 / <video> 广告视频…
 *          <div class="txp_full_screen_pause-close">关闭广告</div>
 *        </div>
 *      </div>
 *    </div>
 *
 *  ⚠ 广告出现时，主视频容器 .txp_videos_container 被播放器压缩为
 *    左下角 294x165 小窗（inline: left/top/width/height/z-index）。
 *    因此「只隐藏广告」不够，必须同时恢复主视频容器几何。
 *  另有横幅变体 .txp_full_screen_pause-bg / -bg-v2（creative-player-v.js 4.4.2）。
 *  ────────────────────────────────────────────────────────────
 *
 * 三层策略：
 *   L1 关按钮   —— 点 .txp_full_screen_pause-close（官方关闭路径，播放器自行恢复）
 *   L2 隐层+复位 —— 隐藏广告根，并把 .txp_videos_container 拉回全屏
 *   L3 几何兜底 —— 不看类名：暂停状态下盖住视频的浮层一律处理（应对改版）
 */
(() => {
  'use strict';

  const FLAG = '__TXV_PAUSE_AD_KILLER__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  if (!/(^|\.)v\.qq\.com$/i.test(location.hostname)) return;

  const MARK = 'data-txvpa';
  const CLOSING = 'data-txvpa-closing';
  const DEFAULTS = { enabled: true, autoClose: true, hideLayer: true, debug: false };
  const cfg = Object.assign({}, DEFAULTS);

  let killed = 0;
  let observer = null;
  let pauseTimer = 0;
  let idleTimer = 0;
  const boundVideos = new WeakSet();

  function log(...a) {
    if (!cfg.debug) return;
    try { console.log('%c[暂停广告清理]', 'color:#12a594;font-weight:600', ...a); } catch (_) { /* ignore */ }
  }

  /* ======================= DOM 基础工具 ======================= */

  function clsOf(el) {
    const c = el.className;
    if (typeof c === 'string') return c;
    if (c && typeof c.baseVal === 'string') return c.baseVal;
    return '';
  }

  function isShown(el) {
    if (!el || !el.isConnected) return false;
    if (el.classList && el.classList.contains('txp_none')) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  let videoCache = null;
  let shadowProbeAt = 0;

  function findVideo() {
    if (videoCache && videoCache.isConnected) return videoCache;
    videoCache = null;

    const v = document.querySelector('video');
    if (v) {
      videoCache = v;
      return v;
    }

    // 穿透 open shadow root（播放器偶尔用影子 DOM 包裹）
    // 全量遍历代价高，这里限流：最多每 2 秒探测一次
    if (Date.now() - shadowProbeAt < 2000) return null;
    shadowProbeAt = Date.now();

    const hosts = document.querySelectorAll('*');
    for (let i = 0; i < hosts.length && i < 3000; i++) {
      const sr = hosts[i].shadowRoot;
      if (sr) {
        const sv = sr.querySelector('video');
        if (sv) {
          videoCache = sv;
          return sv;
        }
      }
    }
    return null;
  }

  /* ==================== L1/L2：精准打击 ==================== */

  // 暂停广告根容器（2026-10 真实页面实证 + 历史版本兼容）
  const AD_ROOTS = [
    '.txp_full_screen_pause-active',   // 全屏型
    '.txp_full_screen_pause-bg',       // 横幅型（实测出现）
    '.txp_full_screen_pause-bg-v2',    // 横幅型 v2
    '.txp_zt',                         // 旧版播放器（内核枚举 AD_TYPE.ZT）
    '.txp_zt_content'
  ];

  // 附加清理目标（关闭后可能残留的小浮层）
  const AD_EXTRAS = [
    '.txp_full_screen_pause-player-mask',  // 暂停播放图标浮层
    '.txp_full_screen_pause-btn',          // 「了解更多」按钮
    '.txp_full_screen_pause-ad-flag'       // 「广告」角标
  ];

  // 关闭按钮（从最精确到最宽）
  const CLOSE_SELECTORS = [
    '.txp_full_screen_pause-close',   // 「关闭广告」（实测：-active 与 -bg 两种形态都有）
    '.txp_zt_close .close',
    '.txp_zt_close'
  ];

  /** 隐藏广告内的 <video>，停声停流量 */
  function pauseAdVideos(root) {
    try {
      root.querySelectorAll('video').forEach((av) => {
        if (!av.paused) { av.pause(); log('已暂停广告视频'); }
      });
    } catch (_) { /* ignore */ }
  }

  /**
   * 恢复主视频容器几何。
   * 广告展示期间播放器把 .txp_videos_container 压成左下角小窗，
   * 这里检测非全屏的内联几何并强制复位。
   */
  function restoreMainVideo(reason) {
    let conts;
    try { conts = document.querySelectorAll('.txp_videos_container'); } catch (_) { return 0; }
    let n = 0;

    for (let i = 0; i < conts.length; i++) {
      const cont = conts[i];
      // 已被我们隐藏的广告内部容器不管
      if (cont.closest('[data-txvpa]')) continue;

      const s = cont.style;
      const bad =
        (s.left && s.left !== '0px') ||
        (s.top && s.top !== '0px') ||
        (s.width && s.width !== '100%') ||
        (s.height && s.height !== '100%') ||
        (s.zIndex && s.zIndex !== '0');
      if (!bad) continue;

      try {
        s.setProperty('left', '0', 'important');
        s.setProperty('top', '0', 'important');
        s.setProperty('width', '100%', 'important');
        s.setProperty('height', '100%', 'important');
        s.setProperty('z-index', '0', 'important');
        killed++;
        log('已恢复视频容器', reason, '→', clsOf(cont) || '(container)');
        n++;
      } catch (_) { /* ignore */ }

      // 画面比例恢复（广告期播放器把 object-fit 改成 contain）
      try {
        const vid = cont.querySelector('video');
        if (vid && getComputedStyle(vid).objectFit === 'contain') {
          vid.style.setProperty('object-fit', 'cover', 'important');
        }
      } catch (_) { /* ignore */ }
    }
    return n;
  }

  function tryClose(root) {
    pauseAdVideos(root);
    for (let i = 0; i < CLOSE_SELECTORS.length; i++) {
      const sel = CLOSE_SELECTORS[i];
      let btn = null;
      try { btn = root.querySelector(sel); } catch (_) { /* ignore */ }
      if (btn && isShown(btn)) {
        try {
          btn.click();
          log('已点击关闭按钮', sel);
          return true;
        } catch (_) { /* ignore */ }
      }
    }
    return false;
  }

  function hideEl(el, reason) {
    if (!el || el.nodeType !== 1) return false;
    if (el === document.body || el === document.documentElement) return false;
    if (el.hasAttribute(MARK)) return false;

    const v = findVideo();
    // 绝不隐藏 video 自身或其祖先（否则整个播放器会消失）
    if (v && (el === v || el.contains(v))) return false;

    el.setAttribute(MARK, reason);
    try {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    } catch (_) { /* ignore */ }

    killed++;
    log('已隐藏', reason, '→', clsOf(el) || el.id || el.tagName);
    return true;
  }

  function sweepExact() {
    if (!cfg.enabled) return 0;
    let n = 0;

    for (let i = 0; i < AD_ROOTS.length; i++) {
      let nodes;
      try { nodes = document.querySelectorAll(AD_ROOTS[i]); } catch (_) { continue; }
      for (let j = 0; j < nodes.length; j++) {
        const el = nodes[j];
        if (el.hasAttribute(MARK)) continue;
        if (!isShown(el)) continue;

        // 去重：祖先已被处理过（例如 .txp_zt 已命中），子节点不再重复点击
        const done = el.parentElement && el.parentElement.closest('[data-txvpa],[data-txvpa-closing]');
        if (done) continue;

        // 已点过关闭，给 300ms 淡出时间；超时仍在就直接隐藏
        const closingAt = el.getAttribute(CLOSING);
        if (closingAt) {
          if (Date.now() - Number(closingAt) < 300) continue;
          if (cfg.hideLayer && hideEl(el, 'close-timeout')) n++;
          continue;
        }

        if (cfg.autoClose && tryClose(el)) {
          el.setAttribute(CLOSING, String(Date.now()));
          n++;
          continue;
        }
        if (cfg.hideLayer && hideEl(el, 'exact')) {
          pauseAdVideos(el);
          n++;
        }
      }
    }

    // 附加浮层：跟随广告出现的小图标/按钮，直接隐藏
    if (cfg.enabled && n >= 0) {
      for (let i = 0; i < AD_EXTRAS.length; i++) {
        let extras;
        try { extras = document.querySelectorAll(AD_EXTRAS[i]); } catch (_) { continue; }
        for (let j = 0; j < extras.length; j++) {
          if (isShown(extras[j]) && cfg.hideLayer) hideEl(extras[j], 'extra');
        }
      }
    }

    // 关键：无论走哪条路径，都要保证主视频容器是全屏的
    if (cfg.enabled && cfg.hideLayer) restoreMainVideo('post-sweep');
    return n;
  }

  /* ==================== L3：几何兜底 ==================== */

  function overlapArea(a, b) {
    const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
    const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return x * y;
  }

  function sweepGeometry() {
    if (!cfg.enabled) return 0;
    const v = findVideo();
    if (!v || !v.paused) return 0;

    const vr = v.getBoundingClientRect();
    if (vr.width < 120 || vr.height < 80) return 0;
    const vArea = vr.width * vr.height;

    // 以 video 为中心向上找作用域，避免遍历整页
    let scope = v.parentElement;
    for (let i = 0; i < 3 && scope && scope.parentElement && scope !== document.body; i++) {
      scope = scope.parentElement;
    }
    if (!scope) return 0;

    let n = 0;
    let all;
    try { all = scope.querySelectorAll('div,section,iframe'); } catch (_) { return 0; }

    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.hasAttribute(MARK)) continue;
      if (el.hasAttribute(CLOSING)) continue;  // 正在等官方关闭生效，别抢它的活
      if (el.contains(v)) continue;          // 祖先链跳过
      if (!isShown(el)) continue;

      const r = el.getBoundingClientRect();
      if (r.height < vr.height * 0.35) continue;       // 控制条 / 提示条排除
      if (overlapArea(r, vr) < vArea * 0.55) continue; // 必须盖住视频主体

      const st = getComputedStyle(el);
      if (st.position !== 'absolute' && st.position !== 'fixed') continue;
      if (st.pointerEvents === 'none') continue;

      // 排除明显的播放器控件容器
      const c = clsOf(el).toLowerCase();
      if (/control|progress|volume|toolbar|danmu|barrage|subtitle|setting|quality|fullscreen/.test(c)) continue;

      if (hideEl(el, 'geometry')) n++;
      if (n >= 3) break; // 一次最多处理 3 个，避免连锁误伤
    }
    return n;
  }

  function sweepAll() {
    const a = sweepExact();
    const b = sweepGeometry();
    return a + b;
  }

  /* ======================= 触发机制 ======================= */

  /** 暂停态高频轮询：广告通常在暂停后 0~2 秒内插入，密采 3 秒后转低频看守 */
  function startPauseWatch() {
    stopPauseWatch();
    let ticks = 0;
    pauseTimer = setInterval(() => {
      ticks++;
      try { sweepAll(); } catch (e) { log('轮询异常', e); }
      if (ticks > 20) {
        clearInterval(pauseTimer);
        pauseTimer = setInterval(() => {
          try { sweepAll(); } catch (_) { /* ignore */ }
        }, 800);
      }
    }, 200);
  }

  function stopPauseWatch() {
    if (pauseTimer) { clearInterval(pauseTimer); pauseTimer = 0; }
  }

  function bindVideo(v) {
    if (!v || boundVideos.has(v)) return;
    boundVideos.add(v);
    log('已绑定 video');

    v.addEventListener('pause', () => {
      log('视频暂停，启动看守');
      startPauseWatch();
      [60, 300, 800, 1500].forEach((ms) => setTimeout(() => {
        try { sweepAll(); } catch (_) { /* ignore */ }
      }, ms));
    }, true);

    v.addEventListener('waiting', () => startPauseWatch(), true);

    v.addEventListener('playing', () => {
      stopPauseWatch();
      try { sweepExact(); } catch (_) { /* ignore */ }
    }, true);
  }

  function looksLikeAd(node) {
    if (!node || node.nodeType !== 1) return false;
    const c = (clsOf(node) + ' ' + (node.id || '')).toLowerCase();
    if (/full_screen_pause|txp_zt|pause_ad|pause-ad|txp_ad/.test(c)) return true;
    try {
      if (node.querySelector && node.querySelector('.txp_full_screen_pause-active,.txp_full_screen_pause-bg,.txp_zt,.txp_zt_content')) return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((records) => {
      if (!cfg.enabled) return;
      for (let i = 0; i < records.length; i++) {
        const added = records[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          if (looksLikeAd(added[j])) {
            try { sweepAll(); } catch (_) { /* ignore */ }
            return;
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  /** 全局低速兜底：即使 pause 事件没捕获到，也不会完全失效 */
  function startIdleWatch() {
    clearInterval(idleTimer);
    idleTimer = setInterval(() => {
      if (!cfg.enabled || document.visibilityState === 'hidden') return;
      const v = findVideo();
      if (v) bindVideo(v);
      try { sweepExact(); } catch (_) { /* ignore */ }
    }, 1500);
  }

  /* ======================= 诊断 ======================= */

  function rectInfo(r) {
    return Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top);
  }

  function diagnose() {
    const v = findVideo();
    const vr = v ? v.getBoundingClientRect() : null;

    const out = {
      url: location.href,
      host: location.hostname,
      inFrame: window.top !== window.self,
      readyState: document.readyState,
      killed: killed,
      cfg: Object.assign({}, cfg),
      video: v
        ? {
            paused: v.paused,
            rect: rectInfo(vr),
            visibility: getComputedStyle(v).visibility,
            opacity: getComputedStyle(v).opacity,
            src: (v.currentSrc || '').slice(0, 100)
          }
        : 'NOT FOUND（可能在 iframe 内或尚未初始化）',
      adCandidates: []
    };

    const probes = '.txp_full_screen_pause-active,.txp_full_screen_pause-bg,.txp_full_screen_pause-bg-v2,.txp_full_screen_pause-close,.txp_zt,.txp_zt_content,.txp_zt_close';
    let found;
    try { found = document.querySelectorAll(probes); } catch (_) { found = []; }
    for (let i = 0; i < found.length && i < 20; i++) {
      const el = found[i];
      const st = getComputedStyle(el);
      out.adCandidates.push({
        cls: clsOf(el).slice(0, 80),
        shown: isShown(el),
        display: st.display,
        position: st.position,
        zIndex: st.zIndex,
        rect: rectInfo(el.getBoundingClientRect()),
        marked: el.hasAttribute(MARK)
      });
    }

    // 采集盖在 video 上的可见浮层（几何兜底的命中情况）
    if (v && vr) {
      let scope = v.parentElement;
      for (let i = 0; i < 3 && scope && scope.parentElement && scope !== document.body; i++) scope = scope.parentElement;
      if (scope) {
        const all = scope.querySelectorAll('div,section,iframe');
        const vArea = vr.width * vr.height;
        let cnt = 0;
        for (let i = 0; i < all.length && cnt < 12; i++) {
          const el = all[i];
          if (el.contains(v) || !isShown(el)) continue;
          const r = el.getBoundingClientRect();
          if (overlapArea(r, vr) < vArea * 0.5) continue;
          const st = getComputedStyle(el);
          if (st.position !== 'absolute' && st.position !== 'fixed') continue;
          cnt++;
          if (!out.overlay) out.overlay = [];
          out.overlay.push({
            cls: clsOf(el).slice(0, 80),
            zIndex: st.zIndex,
            pointerEvents: st.pointerEvents,
            rect: rectInfo(r),
            marked: el.hasAttribute(MARK)
          });
        }
      }
    }

    return out;
  }

  /* ======================= 消息通道 ======================= */

  try {
    chrome.runtime.onMessage.addListener((msg, _s, send) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'txvpa:stats') {
        send({ killed: killed, enabled: cfg.enabled });
        return true;
      }
      if (msg.type === 'txvpa:scan') {
        const n = sweepAll();
        send({ killed: killed, thisRound: n });
        return true;
      }
      if (msg.type === 'txvpa:diag') {
        send(diagnose());
        return true;
      }
      return true;
    });
  } catch (_) { /* ignore */ }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const k in DEFAULTS) if (k in changes) cfg[k] = changes[k].newValue;
      if (cfg.enabled) sweepAll();
    });
  } catch (_) { /* ignore */ }

  /* ======================= 启动 ======================= */

  function timeline() {
    // 播放器初始化后 video 才出现，分段探测绑定
    [300, 1000, 2000, 4000, 8000].forEach((ms) => setTimeout(() => {
      const v = findVideo();
      if (v) bindVideo(v);
    }, ms));
    startIdleWatch();
  }

  function boot() {
    // 就绪标记：外部可通过 <html data-txvpa-ready="1"> 判断 content script 是否已注入
    try { document.documentElement.setAttribute('data-txvpa-ready', '1'); } catch (_) { /* ignore */ }

    try {
      chrome.storage.local.get(DEFAULTS, (v) => {
        Object.assign(cfg, DEFAULTS, v || {});
        if (cfg.debug) document.documentElement.setAttribute('data-txvpa-debug', '1');
        log('v2.1.0 启动', cfg);
        if (!cfg.enabled) return;
        startObserver();
        const v0 = findVideo();
        if (v0) bindVideo(v0);
        timeline();
      });
    } catch (_) {
      startObserver();
      timeline();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
