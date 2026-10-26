#!/usr/bin/env python3
"""把 extensions/ 下的扩展打包成可分发的 zip。

用法：
    python scripts/pack.py                     # 打包全部扩展
    python scripts/pack.py <name> [<name> ...] # 只打包指定扩展

产物：release/<name>-<version>.zip
zip 内以扩展目录为根（manifest.json 位于压缩包第一层），
可直接上传 Chrome Web Store / Edge 加载项商店，或解压后离线加载。

仅使用标准库，无第三方依赖。
"""
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT_DIR = ROOT / "extensions"
OUT_DIR = ROOT / "release"

# 不进入发布包的文件 / 目录
EXCLUDE_NAMES = {
    "gen_icons.py",     # 图标生成脚本，仅开发期用
    "README.md",        # 商店有自己的描述字段
    ".gitignore",
    ".DS_Store",
    "Thumbs.db",
}
EXCLUDE_DIRS = {"__pycache__", ".git", "node_modules", "dist", "build", ".idea", ".vscode"}


def read_manifest(ext_path: Path):
    mf = ext_path / "manifest.json"
    if not mf.is_file():
        return None
    try:
        return json.loads(mf.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"  [跳过] {ext_path.name}: manifest.json 解析失败 -> {e}")
        return None


def collect(ext_path: Path):
    """收集需要打包的文件，返回 (相对路径, 绝对路径) 列表。"""
    items = []
    for p in sorted(ext_path.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(ext_path)
        if any(part in EXCLUDE_DIRS for part in rel.parts[:-1]):
            continue
        if rel.name in EXCLUDE_NAMES:
            continue
        items.append((rel, p))
    return items


def pack_one(ext_path: Path) -> bool:
    manifest = read_manifest(ext_path)
    if manifest is None:
        return False

    name = manifest.get("name") or ext_path.name
    version = manifest.get("version") or "0.0.0"
    out = OUT_DIR / f"{ext_path.name}-{version}.zip"

    files = collect(ext_path)
    if not files:
        print(f"  [跳过] {ext_path.name}: 目录为空")
        return False

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for rel, src in files:
            # 统一用正斜杠，跨平台解压才正常
            zf.write(src, arcname=str(rel).replace("\\", "/"))

    size = out.stat().st_size / 1024
    print(f"  [完成] {name} v{version} -> {out.relative_to(ROOT)}  ({len(files)} 文件, {size:.1f} KB)")
    return True


def main(argv):
    if not EXT_DIR.is_dir():
        print(f"找不到扩展目录：{EXT_DIR}")
        return 1

    if argv:
        targets = []
        for n in argv:
            p = EXT_DIR / n
            if not p.is_dir():
                print(f"找不到扩展：{n}")
                return 1
            targets.append(p)
    else:
        targets = [p for p in sorted(EXT_DIR.iterdir()) if p.is_dir()]

    if not targets:
        print("没有可打包的扩展。")
        return 0

    print(f"打包 {len(targets)} 个扩展：")
    ok = sum(1 for p in targets if pack_one(p))
    print(f"完成 {ok}/{len(targets)}。")
    return 0 if ok == len(targets) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
