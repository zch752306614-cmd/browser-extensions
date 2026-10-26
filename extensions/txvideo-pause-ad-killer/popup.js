/* popup 控制面板逻辑 */
'use strict';

const DEFAULTS = { enabled: true, autoClose: false, debug: false };
const KEYS = Object.keys(DEFAULTS);

const $ = (id) => document.getElementById(id);
const statEl = $('stat');

/* ---------- 读取并回填开关 ---------- */
chrome.storage.local.get(DEFAULTS, (cfg) => {
  KEYS.forEach((k) => { $(k).checked = !!cfg[k]; });
});

/* ---------- 开关写回 ---------- */
KEYS.forEach((k) => {
  $(k).addEventListener('change', (e) => {
    chrome.storage.local.set({ [k]: e.target.checked });
  });
});

/* ---------- 与当前标签页通信 ---------- */
function activeTab(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    cb(tabs && tabs[0]);
  });
}

function render(viaMessage) {
  activeTab((tab) => {
    if (!tab) {
      statEl.textContent = '未找到活动标签页';
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: 'txvpa:stats' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        statEl.innerHTML = '当前页面未注入脚本<br>请打开 v.qq.com 的播放页后重试';
        return;
      }
      let html = `本页已清理：<b>${res.killed}</b> 次`;
      if (viaMessage && typeof viaMessage.thisRound === 'number') {
        html += `　（本次 +${viaMessage.thisRound}）`;
      }
      if (!res.enabled) {
        html += '<br>清理已关闭，打开上方开关后刷新页面';
      }
      statEl.innerHTML = html;
    });
  });
}

/* ---------- 立即清理 ---------- */
$('rescan').addEventListener('click', () => {
  activeTab((tab) => {
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { type: 'txvpa:scan' }, (res) => {
      if (chrome.runtime.lastError || !res) {
        statEl.innerHTML = '当前页面未注入脚本<br>请打开 v.qq.com 的播放页后重试';
        return;
      }
      render(res);
    });
  });
});

render();
