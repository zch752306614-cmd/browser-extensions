# txvideo-pause-ad-killer

自动关闭腾讯视频（v.qq.com）**暂停时出现的广告**，恢复完整视频画面。

当前版本 **v2.2.0**。类名与结构来自 2026-10 用真实登录环境触发暂停广告后抓取的实际 DOM，非猜测。

## v2.2.0：修复「暂停后鼠标点击播放/暂停失效」

**根因**：播放器自己的点击遮罩 `.thumbplayer-user-mod`（superplayer 内核源码实证：
`addEventListener("click", ...)` 在这里切换播放/暂停，100% 铺满、绝对定位）满足
L3 几何兜底的全部特征，导致**每次暂停都被误隐藏**——鼠标点击失去接收者，
而空格键走键盘事件不受影响。

**修复**：

1. **受保护名单**：`thumbplayer-user-mod`、`plugin_ctrl_*`（控制条/阴影）、
   `txp_control|click|progress|danmu…` 及内部含这些节点的容器，一律不隐藏
2. **广告特征前置校验**：L3 只处理有广告证据（广告类名 / creative-player 祖先 /
   「广告·赞助·了解更多」文案）的浮层，无证据绝不动作
3. **自愈**：启动后自动还原旧版本误隐藏的受保护节点，不用刷新页面

## 安装

1. 打开 `chrome://extensions/`（Edge 是 `edge://extensions/`）
2. 开启右上角「开发者模式」
3. 「加载已解压的扩展程序」→ 选择本目录（`txvideo-pause-ad-killer`）

## ⚠ 更新扩展时的坑（必须知道）

Chrome 137+ 会把「加载已解压的扩展」**复制**一份到 profile 内：

```
%LOCALAPPDATA%\Google\Chrome\User Data\Default\UnpackedExtensions\<名称>-<版本>_<id>
```

之后 Chrome 实际运行的是**那份副本**，不是你的源目录。所以改了源码再点「重新加载」，
如果副本没更新，跑的还是旧代码（本扩展曾因此被误判为"没效果"，实际是 Chrome 一直在跑 v1.0.0 快照）。

正确做法，二选一：

- **改完源目录后**：在 `chrome://extensions/` 里**移除**旧条目 → 重新「加载已解压的扩展程序」指向源目录，让它重新复制
- **要给已加载的副本打补丁**：直接把文件覆盖到上面那个 `UnpackedExtensions\...` 目录，再点卡片上的刷新按钮

判断当前跑的是哪版：打开扩展弹窗，底部有版本号；或页面控制台执行
`document.documentElement.dataset.txvpaReady`，返回 `1` 表示 content script 已注入。

## 真实广告结构（实证）

暂停时播放器插入：

```html
<div class="creative-player-4-layer">
  <div class="txp_full_screen_pause-active">      <!-- 铺满播放器, z-index:1000 -->
    <div class="txp_full_screen_pause-active-mask">      <!-- 广告底图 -->
    <div class="txp_full_screen_pause-active-content">
      ...二维码/文案/广告视频...
      <div class="txp_full_screen_pause-close">关闭广告</div>
    </div>
  </div>
</div>
```

⚠ 关键细节：广告出现时播放器把主视频容器 `.txp_videos_container`
压缩为左下角 294×165 小窗。**只隐藏广告不够，必须同时恢复容器几何**，
否则画面一直是小窗。

另有横幅变体 `.txp_full_screen_pause-bg` / `-bg-v2`。

## 实现逻辑（三层）

| 层 | 策略 | 说明 |
| --- | --- | --- |
| L1 | 点官方关闭 | 点 `.txp_full_screen_pause-close`，播放器自行恢复画面（最干净） |
| L2 | 隐藏 + 复位 | 关闭按钮点不动时：隐藏广告根 + 暂停广告视频 + 把 `.txp_videos_container` 复位为全屏 |
| L3 | 几何兜底 | 不看类名但有广告特征前置校验：暂停态下盖住视频 ≥55%、带广告证据的可点击浮层才处理，防未来改版 |

触发：`video` 的 pause 事件 + MutationObserver（新增广告节点即时响应）+ 暂停态高频轮询（200ms×20 次后转 800ms 看守）。

## 验证记录（2026-10-26）

在真实 v.qq.com 播放页 + 真实登录态下验证（v2.2.0，三阶段全部 PASS）：

- **A 真实暂停（无广告）**：点击遮罩 `thumbplayer-user-mod` 存活，鼠标点击可正常切换播放/暂停 ✅
- **B `-active` 全屏型广告（关闭按钮有效）**：走官方关闭路径，广告清除、画面全屏、点击可用 ✅
- **C `-bg` 横幅型广告（关闭按钮失效）**：走隐藏+复位兜底，广告清除、容器恢复 982×552、点击可用 ✅

（真实广告受频次控制，短期内重复暂停不再投放；B/C 用真实抓取结构的忠实复刻验证。）

## 工具栏弹窗

- 总开关 / 「尝试点关闭」/「调试日志」/「立即清理一次」
- 显示当前页清理次数

## 注意

- 腾讯视频前端改版频繁，失效时打开弹窗「调试日志」看控制台输出，补选择器即可
- 仅申请 `storage` 与 `v.qq.com` 权限，无网络请求
