"""
把小逻辑打包成单文件 exe（Windows）

用法：
    pip install -r build/requirements.txt
    python build/build-exe.py

产物：build/dist/小逻辑.exe（约 17 MB，WebView2 内核，原生窗口）

原理：
    1. 把 interpreter.js 内联进 index.html，得到自包含的 kidlang.html
    2. 用 pyinstaller 把 launcher_pw.py 和这个 html 一起打成单文件
"""

import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
WORK = os.path.join(BUILD, "work")
OUT = os.path.join(BUILD, "dist")
SINGLE = os.path.join(WORK, "kidlang.html")

SCRIPT_TAG = '<script src="interpreter.js"></script>'


def inline_single_file():
    index_path = os.path.join(ROOT, "index.html")
    js_path = os.path.join(ROOT, "interpreter.js")

    if not os.path.exists(index_path) or not os.path.exists(js_path):
        sys.exit("找不到 index.html 或 interpreter.js")

    html = open(index_path, encoding="utf-8").read()
    js = open(js_path, encoding="utf-8").read()

    if SCRIPT_TAG not in html:
        sys.exit("index.html 里没找到 <%s>，无法内联" % SCRIPT_TAG)

    html = html.replace(SCRIPT_TAG, "<script>\n" + js + "\n</script>")

    os.makedirs(WORK, exist_ok=True)
    with open(SINGLE, "w", encoding="utf-8") as f:
        f.write(html)

    print("[1/2] 已合并单文件 %.0f KB" % (len(html.encode("utf-8")) / 1024))


def build_exe():
    launcher = os.path.join(BUILD, "launcher_pw.py")
    if not os.path.exists(launcher):
        sys.exit("找不到 build/launcher_pw.py")

    icon = os.path.join(ROOT, "assets", "icon.ico")
    args = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--noconsole",
        "--name", "KidLang",
        "--add-data", SINGLE + os.pathsep + ".",
        "--collect-all", "webview",
        "--hidden-import", "webview.platforms.edgechromium",
        "--hidden-import", "clr",
        "--distpath", OUT,
        "--workpath", WORK,
        "--specpath", WORK,
    ]
    if os.path.exists(icon):
        args += ["--icon", icon]

    args.append(launcher)

    print("[2/2] 正在打包 exe ...")
    r = subprocess.run(args, cwd=ROOT)
    if r.returncode != 0:
        sys.exit("打包失败")

    exe = os.path.join(OUT, "KidLang.exe")
    if os.path.exists(exe):
        size = os.path.getsize(exe) / 1024 / 1024
        print("\n完成：%s （%.1f MB）" % (exe, size))
        print("提示：exe 会优先加载同目录的 kidlang.html；没有才用内嵌的那份。")


if __name__ == "__main__":
    inline_single_file()
    build_exe()
