/*!
 * TxVideoPauseAdKiller —— 腾讯视频暂停广告清理
 * 作用域：仅 v.qq.com
 *
 * 策略（三层，逐层兜底）
 *   1. 精确选择器：命中已知的暂停广告容器，直接隐藏（最快、最准）
 *   2. 启发式评分：类名/属性/文案 + 几何位置 + 层级，综合打分后隐藏
 *   3. CSS 兜底层（content.css）：document_start 即生效，防闪现
 *
 * 触发时机
 *   · video 的 pause / waiting 事件（暂停广告出现的主因）
 *   · MutationObserver 增量监听（广告节点异步插入）
 *   · 暂停状态下的低频兜底轮询（应对懒插入、延迟渲染）
 */
(() => {
  'use strict';

  const FLAG = '__TXV_PAUSE_AD_KILLER__';
  if (window[FLAG]) return;
  window[FLAG] = true;

  if (!/(^|\.)v\.qq\.com$/i.test(location.hostname)) return;

  /* ============================ 配置 ============================ */

  const MARK = 'data-txvpa';
  const DEFAULTS = { enabled: true, autoClose: false, debug: false };
  const cfg = Object.assign({}, DEFAULTS);

  const TICK_MS = 2000;   // 暂停状态兜底轮询间隔
  const SCAN_THRESHOLD = 5; // 启发式得分阈值

  let killCount = 0;
  let scanTimer = 0;
  let tickTimer = 0;
  let observer = null;
  const boundVideos = new WeakSet();

  /* ============================ 工具 ============================ */

  function log(...args) {
    if (!cfg.debug) return;
    try {
      console.log('%c[暂停广告清理]', 'color:#12a594;font-weight:600', ...args);
    } catch (_) { /* ignore */ }
  }

  function clsOf(el) {
    const c = el.className;
    if (typeof c === 'string') return c;
    if (c && typeof c.baseVal === 'string') return c.baseVal;
    return '';
  }

  /** 把 id / class / data-* / title / aria-label 拼成一个可匹配的小写串 */
  function descriptor(el) {
    if (!el || el.nodeType !== 1) return '';
    let s = el.id ? el.id + ' ' : '';
    s += clsOf(el);
    const attrs = el.attributes;
    if (attrs) {
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i];
        const n = a.name;
        if (n === 'id' || n === 'class') continue;
        if (n.charCodeAt(0) === 100 || n === 'title' || n === 'aria-label') {
          // d 开头 ≈ data-*，顺带覆盖 dl / dir 等，成本极低
          s += ' ' + n + '=' + a.value;
        }
      }
    }
    return s.toLowerCase();
  }

  /** 安全取文本，元素过大时跳过（性能保护） */
  function textOf(el, limit) {
    if (el.childElementCount > 40) return '';
    const t = el.textContent || '';
    return t.length > (limit || 220) ? t.slice(0, limit || 220) : t;
  }

  function isShown(el) {
    if (!el.isConnected) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  /* ======================= 第一层：精确选择器 ======================= */

  const EXACT = [
    '#txp_ad_pause', '#txp_ad_pause_mask', '#txp_ad_pop', '#txp_ad_mask',
    '#txp_ad_pause_wrap', '#txp-ad-pause',
    '.txp_ad_pause', '.txp_ad_pause_mask', '.txp_ad_pop', '.txp_ad_mask',
    '.txp_ad_pause_wrap', '.txp-pause-ad', '.txp-pause-ad-mask',
    '.txp_pause_ad', '.txv-pause-ad', '.txv_pause_ad', '.txv-ad-pause',
    '.txv-player-pause-ad', '.player-pause-ad', '.pause-ad-container',
    '.video-pause-ad', '.pause_ad', '.pauseAd',
    '[class*="txp_ad_pause"]', '[class*="txp-ad-pause"]',
    '[class*="pause-ad-mask"]', '[class*="pauseAdWrap"]',
    '[data-txp-pause-ad]'
  ];

  /* ======================= 第二层：启发式评分 ======================= */

  // 命中即排除：这些是播放器正常控件或页面模块
  const PROTECT_RE = /control|progress|volume|toolbar|danmu|barrage|comment|subtitle|setting|quality|bitrate|fullscreen|loading|skeleton|recommend|header|footer|search|breadcrumb/;

  function score(el, videoRect) {
    if (!el.isConnected || el.hasAttribute(MARK)) return 0;
    if (!isShown(el)) return 0;

    const d = descriptor(el);
    let s = 0;
    let strong = false;

    if (/pause[-_ ]?ad/i.test(d)) { s += 4; strong = true; }
    if (/(^|[\s#._\-])ads?([\s#._\-]|$)/i.test(d)) { s += 3; strong = true; }

    if (!strong) {
      const t = textOf(el);
      if (t) {
        if (/广告|赞助|推广/.test(t)) s += 2;
        if (/跳过.{0,4}广告|关闭广告/.test(t)) s += 2;
      }
      if (s === 0) return 0; // 无明显广告线索，快速否决
    }

    const r = el.getBoundingClientRect();
    if (r.width < 50 || r.height < 40) return 0;

    if (videoRect && videoRect.width > 0) {
      const ratio = (r.width * r.height) / (videoRect.width * videoRect.height);
      if (ratio < 0.12) return 0;        // 暂停广告必然覆盖较大面积
      if (ratio >= 0.25) s += 2;
    }

    const st = getComputedStyle(el);
    if (st.position === 'fixed' || st.position === 'absolute') s += 1;
    if ((parseInt(st.zIndex, 10) || 0) >= 10) s += 1;
    if (st.pointerEvents !== 'none') s += 1;

    if (PROTECT_RE.test(d)) s -= 4;

    return s;
  }

  /* ============================ 隐藏动作 ============================ */

  function kill(el, reason) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute(MARK)) return false;
    if (el === document.body || el === document.documentElement) return false;
    const tag = el.tagName;
    if (tag === 'VIDEO' || tag === 'AUDIO') return false;

    el.setAttribute(MARK, reason);
    try {
      el.style.setProperty('display', 'none', 'important');
      el.style.setProperty('pointer-events', 'none', 'important');
    } catch (_) { /* ignore */ }

    if (cfg.autoClose) tryCloseButton(el);

    killCount++;
    log('已隐藏 →', reason, el.id ? '#' + el.id : '.' + (clsOf(el).split(' ')[0] || tag), el);
    return true;
  }

  /** 可选：点击广告自带的关闭按钮（某些版本不点会卡住播放器状态） */
  const CLOSE_SEL = [
    '[class*="close"]', '[aria-label*="关闭"]', '[title*="关闭"]',
    '[class*="Close"]', '[class*="btn-close"]'
  ];

  function tryCloseButton(container) {
    for (const sel of CLOSE_SEL) {
      let btn = null;
      try { btn = container.querySelector(sel); } catch (_) { continue; }
      if (btn && isShown(btn)) {
        try { btn.click(); log('已点击关闭按钮', sel); } catch (_) { /* ignore */ }
        return;
      }
    }
  }

  /* ============================ 主扫描 ============================ */

  function playerRoot(video) {
    return (
      document.querySelector('#player-container') ||
      document.querySelector('.txp_player') ||
      document.querySelector('#mod_player') ||
      (video && video.closest('div[class*="player"]')) ||
      (video && video.parentElement) ||
      null
    );
  }

  function run() {
    if (!cfg.enabled) return 0;
    if (document.visibilityState === 'hidden') return 0;

    const video = document.querySelector('video');
    const root = playerRoot(video);
    let hit = 0;

    // --- 第 1 层：精确选择器（全文档，querySelectorAll 本身很快） ---
    for (let i = 0; i < EXACT.length; i++) {
      const sel = EXACT[i];
      let list;
      try { list = document.querySelectorAll(sel); } catch (_) { continue; }
      for (let j = 0; j < list.length; j++) {
        if (kill(list[j], 'selector' + (i + 1))) hit++;
      }
    }

    // --- 第 2 层：启发式（仅限播放器容器内部，避免误伤页面其他区域） ---
    if (root && root !== document.body && root !== document.documentElement) {
      const vr = video ? video.getBoundingClientRect() : null;
      const base = vr && vr.width > 0 ? vr : root.getBoundingClientRect();
      let candidates;
      try {
        candidates = root.querySelectorAll('div,section,aside,iframe');
      } catch (_) {
        candidates = [];
      }
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (el.hasAttribute(MARK)) continue;
        if (score(el, base) >= SCAN_THRESHOLD) {
          if (kill(el, 'heuristic')) hit++;
        }
      }
    }

    if (hit) {
      // 广告层有时顺手把 video 设成 hidden，恢复回来
      if (video) {
        const vs = getComputedStyle(video);
        if (vs.visibility === 'hidden' || vs.opacity === '0') {
          try {
            video.style.setProperty('visibility', 'visible', 'important');
            video.style.setProperty('opacity', '1', 'important');
          } catch (_) { /* ignore */ }
        }
      }
      log('本轮共清理', hit, '个节点，累计', killCount);
    }

    return hit;
  }

  function schedule(delay) {
    if (!cfg.enabled) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      try { run(); } catch (e) { log('扫描异常', e); }
    }, delay == null ? 150 : delay);
  }

  /* ========================= 事件监听 ========================= */

  function bindVideo(v) {
    if (!v || boundVideos.has(v)) return;
    boundVideos.add(v);
    log('已绑定 video 元素');

    v.addEventListener('pause', () => {
      schedule(60);
      setTimeout(() => schedule(0), 350);
      setTimeout(() => schedule(0), 900);
      setTimeout(() => schedule(0), 1800);
    }, true);

    v.addEventListener('waiting', () => schedule(250), true);
    v.addEventListener('playing', () => schedule(150), true);
  }

  function looksSuspicious(node) {
    if (!node || node.nodeType !== 1) return false;
    const d = descriptor(node);
    if (!d) return true; // 没有 id/class 的新节点反而值得看一眼
    if (/(^|[\s#._\-])ads?([\s#._\-]|$)/i.test(d)) return true;
    if (/pause/i.test(d)) return true;
    if (/advert|sponsor|guanggao/i.test(d)) return true;
    // 子树里可能直接塞了广告容器 / 广告 iframe
    try {
      if (node.querySelector &&
          node.querySelector('[class*="txp_ad"],[class*="-ad-"],[id*="ad_"],iframe')) {
        return true;
      }
    } catch (_) { /* ignore */ }
    return false;
  }

  function startObserver() {
    if (observer || !document.documentElement) return;
    observer = new MutationObserver((records) => {
      if (!cfg.enabled) return;
      outer:
      for (let i = 0; i < records.length; i++) {
        const added = records[i].addedNodes;
        for (let j = 0; j < added.length; j++) {
          if (looksSuspicious(added[j])) {
            schedule(90);
            break outer;
          }
        }
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function startTick() {
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (!cfg.enabled || document.visibilityState === 'hidden') return;
      const v = document.querySelector('video');
      if (v) {
        bindVideo(v);
        if (v.paused) {
          try { run(); } catch (e) { log('轮询异常', e); }
        }
      }
    }, TICK_MS);
  }

  /* ============================ 消息 ============================ */

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'txvpa:stats') {
        sendResponse({ killed: killCount, enabled: cfg.enabled });
        return true;
      }
      if (msg.type === 'txvpa:scan') {
        const n = run();
        sendResponse({ killed: killCount, thisRound: n });
        return true;
      }
      return true;
    });
  } catch (_) { /* 扩展上下文失效时忽略 */ }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const k in DEFAULTS) {
        if (k in changes) cfg[k] = changes[k].newValue;
      }
      log('配置更新', cfg);
      if (cfg.enabled) schedule(0);
    });
  } catch (_) { /* ignore */ }

  /* ============================ 启动 ============================ */

  function boot() {
    let ready = false;
    try {
      chrome.storage.local.get(DEFAULTS, (v) => {
        Object.assign(cfg, DEFAULTS, v || {});
        ready = true;
        log('启动，配置：', cfg);
        if (!cfg.enabled) return;
        startObserver();
        const v0 = document.querySelector('video');
        if (v0) bindVideo(v0);
        schedule(150);
        startTick();
      });
    } catch (_) {
      // 无扩展上下文（例如被注入到普通页面）时也照常工作
      ready = true;
      startObserver();
      schedule(150);
      startTick();
    }
    // 兜底：storage 回调异常时也要跑起来
    setTimeout(() => {
      if (!ready) { startObserver(); schedule(200); startTick(); }
    }, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
