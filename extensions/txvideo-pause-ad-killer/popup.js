/* popup 控制面板逻辑 —— v2.1.0 */
'use strict';

const DEFAULTS = { enabled: true, autoClose: true, hideLayer: true, debug: false };
const KEYS = Object.keys(DEFAULTS);

const $ = (id) => document.getElementById(id);
const statEl = $('stat');
const outEl = $('out');

/* ---------- 读取并回填开关 ---------- */
chrome.storage.local.get(DEFAULTS, (cfg) => {
  KEYS.forEach((k) => {
    const el = $(k);
    if (el) el.checked = !!cfg[k];
  });
});

/* ---------- 开关写回 ---------- */
KEYS.forEach((k) => {
  const el = $(k);
  if (!el) return;
  el.addEventListener('change', (e) => {
    chrome.storage.local.set({ [k]: e.target.checked });
  });
});

/* ---------- 与当前标签页通信 ---------- */
function withTab(fn) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) {
      statEl.textContent = '未找到活动标签页';
      return;
    }
    chrome.tabs.sendMessage(tab.id, fn.msg, (res) => {
      if (chrome.runtime.lastError || !res) {
        statEl.innerHTML = '当前页面未注入脚本<br>请打开 v.qq.com 的播放页后重试';
        return;
      }
      fn.ok(res);
    });
  });
}

/* ---------- 统计渲染 ---------- */
function renderStats(res) {
  let html = `本页已清理：<b>${res.killed}</b> 次`;
  if (typeof res.thisRound === 'number') html += `　（本次 +${res.thisRound}）`;
  if (!res.enabled) html += '<br>清理已关闭，打开上方开关后刷新页面';
  statEl.innerHTML = html;
}

function loadStats() {
  withTab({ msg: { type: 'txvpa:stats' }, ok: renderStats });
}

/* ---------- 立即清理 ---------- */
$('rescan').addEventListener('click', () => {
  withTab({
    msg: { type: 'txvpa:scan' },
    ok: (res) => {
      renderStats(res);
      outEl.hidden = true;
    },
  });
});

/* ---------- 诊断 ---------- */
$('diag').addEventListener('click', () => {
  withTab({
    msg: { type: 'txvpa:diag' },
    ok: (res) => {
      const text = JSON.stringify(res, null, 2);
      outEl.hidden = false;
      outEl.textContent = text;

      // 顺手复制到剪贴板，方便直接贴给开发者
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          () => { statEl.innerHTML = '诊断信息已复制到剪贴板，可直接粘贴反馈'; },
          () => { statEl.innerHTML = '诊断完成（复制失败，请手动选中下方文本）'; }
        );
      } else {
        statEl.innerHTML = '诊断完成（请手动选中下方文本复制）';
      }
    },
  });
});

loadStats();
