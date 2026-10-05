# -*- coding: utf-8 -*-
"""EVERNOT 筆記 — PWA 圖示產生腳本
執行：python scripts/generate_icons.py
產出：icons/icon-192.png、icons/icon-512.png（綠底白筆記本圖樣）
"""
import os
from PIL import Image, ImageDraw

GREEN = (15, 123, 77, 255)
WHITE = (255, 255, 255, 255)
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'icons')
os.makedirs(OUT_DIR, exist_ok=True)


def draw_icon(size):
    # 以 4 倍解析度繪製再縮小，避免鋸齒
    S = size * 4
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # 背景：綠色圓角方形（maskable 安全區留白）
    pad = int(S * 0.06)
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=int(S * 0.22), fill=GREEN)

    # 白色筆記本外框
    box = [int(S * 0.24), int(S * 0.20), int(S * 0.76), int(S * 0.80)]
    lw = max(6, int(S * 0.035))
    d.rounded_rectangle(box, radius=int(S * 0.06), outline=WHITE, width=lw)

    # 內頁線條
    line_w = max(6, int(S * 0.028))
    for i, y in enumerate((0.34, 0.46, 0.58)):
        y0 = int(S * y)
        d.line([int(S * 0.31), y0, int(S * 0.69), y0], fill=WHITE, width=line_w)

    # 右上角折頁
    fx = box[2]
    fy = box[1]
    fold = int(S * 0.10)
    d.line([fx - fold, fy + lw, fx - fold, fy + fold], fill=WHITE, width=lw)
    d.line([fx - fold, fy + fold, fx - lw, fy + fold], fill=WHITE, width=lw)

    # 待辦勾選方塊
    d.rounded_rectangle([int(S * 0.31), int(S * 0.68), int(S * 0.38), int(S * 0.75)], radius=int(S * 0.012), outline=WHITE, width=line_w)
    d.line([int(S * 0.33), int(S * 0.715), int(S * 0.345), int(S * 0.73)], fill=WHITE, width=line_w)
    d.line([int(S * 0.345), int(S * 0.73), int(S * 0.375), int(S * 0.695)], fill=WHITE, width=line_w)

    return img.resize((size, size), Image.LANCZOS)


for size in (192, 512):
    draw_icon(size).save(os.path.join(OUT_DIR, f'icon-{size}.png'))
    print(f'icon-{size}.png 已產生')
