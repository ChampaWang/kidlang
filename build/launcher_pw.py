"""
小逻辑 KidLang v0.2 —— 桌面版启动器

用 WebView2 内核渲染，是一个真正的原生窗口：
没有地址栏、没有标签页，只有标题栏和一个关闭按钮。
"""

import os
import sys


def base_dir():
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def find_html():
    cands = [os.path.join(base_dir(), "kidlang.html")]
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        cands.append(os.path.join(meipass, "kidlang.html"))
    for p in cands:
        if os.path.exists(p):
            return p
    return None


def fail(msg):
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        messagebox.showerror("小逻辑", msg)
        root.destroy()
    except Exception:
        pass
    sys.exit(1)


def main():
    html = find_html()
    if not html:
        fail("没有找到 kidlang.html。\n请把它放在本程序同一目录下。")

    try:
        import webview
    except Exception as e:
        fail(
            "启动失败：缺少 WebView2 运行时。\n\n"
            "Windows 10/11 一般自带；如果没有，请安装\n"
            "Microsoft Edge WebView2 Runtime 后重试。\n\n"
            "详情：" + str(e)
        )

    webview.create_window(
        "小逻辑 v0.2",
        html,
        width=1520,
        height=920,
        min_size=(1020, 640),
        background_color="#f3f5f9",
        text_select=True,
    )
    webview.start()


if __name__ == "__main__":
    main()
