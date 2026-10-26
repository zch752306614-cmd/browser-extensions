"""生成扩展图标（纯标准库，无第三方依赖）。
设计：红色圆形底 + 白色暂停双竖条，语义 = "暂停广告"。
"""
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
SS = 4  # 超采样倍数

RED = (0xE5, 0x48, 0x4D)
WHITE = (0xFF, 0xFF, 0xFF)


def build(size):
    S = size * SS
    cx = cy = S / 2.0
    R = S * 0.46

    bw = S * 0.108          # 竖条宽
    bh = S * 0.360          # 竖条高
    gap = S * 0.118         # 两竖条间距
    bar_y0 = cy - bh / 2.0
    left_x0 = cx - gap / 2.0 - bw
    right_x0 = cx + gap / 2.0

    # 1) 超采样绘制
    hi = [[(0, 0, 0, 0)] * S for _ in range(S)]
    for y in range(S):
        dy = y - cy
        row = hi[y]
        for x in range(S):
            dx = x - cx
            if dx * dx + dy * dy > R * R:
                continue
            in_bar = (bar_y0 <= y <= bar_y0 + bh) and (
                (left_x0 <= x <= left_x0 + bw) or (right_x0 <= x <= right_x0 + bw)
            )
            if in_bar:
                row[x] = WHITE + (254,)  # alpha=254 标记"已画竖条"
    for y in range(S):
        row = hi[y]
        for x in range(S):
            if row[x][3] == 254:
                continue
            dx = x - cx
            dy = y - cy
            if dx * dx + dy * dy <= R * R:
                row[x] = RED + (255,)

    # 2) 降采样
    total = SS * SS
    pixels = []
    for oy in range(size):
        line = []
        for ox in range(size):
            r = g = b = a = cnt = 0
            for sy in range(SS):
                r0 = hi[oy * SS + sy]
                for sx in range(SS):
                    p = r0[ox * SS + sx]
                    al = p[3]
                    if al:
                        r += p[0]
                        g += p[1]
                        b += p[2]
                        a += al
                        cnt += 1
            if cnt:
                line.append(
                    (
                        min(255, int(r / cnt)),
                        min(255, int(g / cnt)),
                        min(255, int(b / cnt)),
                        int(a / total),
                    )
                )
            else:
                line.append((0, 0, 0, 0))
        pixels.append(line)
    return pixels


def write_png(path, pixels):
    size = len(pixels)
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        for px in row:
            raw.extend(px)

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for s in (16, 32, 48, 128):
        write_png(os.path.join(OUT_DIR, "icon%d.png" % s), build(s))
        print("icon%d.png" % s, "ok")


if __name__ == "__main__":
    main()
