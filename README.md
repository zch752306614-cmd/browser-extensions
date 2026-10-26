# 浏览器扩展总仓库（Browser Extensions）

自用浏览器扩展的单一仓库管理。每个扩展是一个**独立可加载**的目录，互不干扰，共用一套工程约定。

## 扩展清单

| 扩展 | 作用 | 版本 | 目录 |
| --- | --- | --- | --- |
| 腾讯视频暂停广告清理 | 自动隐藏 v.qq.com 暂停时弹出的广告浮层 | 1.0.0 | [`extensions/txvideo-pause-ad-killer`](extensions/txvideo-pause-ad-killer) |

## 目录约定

```
browser-extensions/
├── extensions/                  # 所有扩展，一个子目录 = 一个扩展
│   └── <extension-name>/
│       ├── manifest.json        # MV3 清单（必备）
│       ├── icons/               # 图标 16/32/48/128
│       ├── ...                  # 源码
│       └── README.md            # 该扩展的说明与排障
├── scripts/
│   └── pack.py                  # 打包成可分发 zip
├── release/                     # 打包产物（已被 .gitignore 忽略）
├── .gitignore
└── README.md
```

约定：

- **一个扩展一个目录**，目录名用小写短横线（kebab-case），与 `manifest.json` 里的 `name` 不必一致但语义要对应。
- **纯静态、免构建**优先：能直接「加载已解压的扩展程序」就用，不引入打包工具链。确有构建需求的，产物输出到该扩展自己的 `dist/`（已忽略）。
- **权限最小化**：只申请实际用到的 `permissions` 和 `host_permissions`。
- 每个扩展自带一份 `README.md`，写清楚安装、原理、失效时怎么反馈。

## 加载到浏览器

Chrome / Edge 通用：

1. 地址栏打开 `chrome://extensions/` 或 `edge://extensions/`
2. 打开「开发者模式」
3. 「加载已解压的扩展程序」→ 选中 `extensions/<某个扩展>` 目录（**不是**仓库根目录）

改完代码后，回扩展页点该卡片的刷新 ↻，再刷新目标网页。

## 打包分发

```bash
python scripts/pack.py                      # 打包全部
python scripts/pack.py txvideo-pause-ad-killer   # 只打一个
```

产物在 `release/<扩展名>-<版本>.zip`，可直接上传到 Chrome Web Store / Edge 加载项商店，或发给别人离线安装。

## 新增一个扩展

1. 建目录 `extensions/<name>/`
2. 放 `manifest.json`（MV3），至少包含 `name` / `version` / `description` / `content_scripts` 或 `action`
3. 加上 `icons/`（可选，但发布必需）
4. 写 `README.md`
5. 把新条目补进上面的「扩展清单」表格
6. `python scripts/pack.py <name>` 验证能正常打包

## 说明

仓库内扩展均为个人使用向的浏览体验优化工具，不收集、不上传任何数据，全部逻辑在本地运行。
