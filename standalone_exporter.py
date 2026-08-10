# -*- coding: utf-8 -*-
import ctypes
import json
import os
import re
import subprocess
import threading
import time
import urllib.request
from pathlib import Path
from tkinter import Tk, Button, Label, messagebox

import websocket


PORT = 9222
PROFILE = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "ChatGPTExporterProfile"

JS_EXTRACT = r"""
(() => {
  const clean = (s) => (s || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const nodes = [...document.querySelectorAll("[data-message-author-role]")];
  const messages = nodes.map((node) => {
    const role = node.getAttribute("data-message-author-role") || "message";
    const root = node.querySelector(".markdown") || node;
    const text = clean(root.innerText || root.textContent || "");
    return { role, text };
  }).filter((m) => m.text);

  const title = (document.title || "ChatGPT Conversation")
    .replace(/\s*[|-]\s*ChatGPT\s*$/i, "")
    .trim() || "ChatGPT Conversation";

  const body = messages.map((m) => {
    const role = m.role === "user" ? "User" : "ChatGPT";
    return `## ${role}\n\n${m.text}`;
  }).join("\n\n---\n\n");

  return {
    title,
    count: messages.length,
    markdown: `# ${title}\n\n- URL: ${location.href}\n- Extracted: ${new Date().toLocaleString()}\n- Messages: ${messages.length}\n\n${body}\n`
  };
})()
"""


def desktop_dir():
    try:
        buf = ctypes.create_unicode_buffer(260)
        ctypes.windll.shell32.SHGetFolderPathW(None, 0, None, 0, buf)
        path = Path(buf.value)
        if path.exists():
            return path
    except Exception:
        pass
    return Path.home() / "Desktop"


def safe_name(name):
    name = re.sub(r'[\\/:*?"<>|\s]+', "_", name).strip("_")
    return name[:80] or "chatgpt_conversation"


def find_browser():
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        str(Path(os.environ.get("LOCALAPPDATA", "")) / r"Google\Chrome\Application\chrome.exe"),
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for path in candidates:
        if Path(path).exists():
            return path
    raise RuntimeError("Chrome 또는 Edge를 찾지 못했습니다.")


def open_browser():
    PROFILE.mkdir(parents=True, exist_ok=True)
    subprocess.Popen(
        [
            find_browser(),
            f"--remote-debugging-port={PORT}",
            "--remote-allow-origins=*",
            f"--user-data-dir={PROFILE}",
            "https://chatgpt.com/",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def pages():
    with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json", timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))


def chatgpt_page():
    for page in pages():
        url = page.get("url", "")
        if "chatgpt.com" in url or "chat.openai.com" in url:
            return page
    raise RuntimeError("ChatGPT 탭을 찾지 못했습니다. 프로그램이 연 Edge 창에서 대화를 여세요.")


def eval_js(ws_url, expression):
    ws = websocket.create_connection(ws_url, timeout=10, origin="http://127.0.0.1")
    try:
        ws.send(json.dumps({
            "id": 1,
            "method": "Runtime.evaluate",
            "params": {
                "expression": expression,
                "returnByValue": True,
                "awaitPromise": True,
            },
        }))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == 1:
                if "exceptionDetails" in msg.get("result", {}):
                    raise RuntimeError("브라우저 안에서 추출 스크립트 실행 실패")
                value = msg.get("result", {}).get("result", {}).get("value")
                if not value:
                    raise RuntimeError("추출 결과가 비었습니다.")
                return value
    finally:
        ws.close()


def split_side_talk(markdown):
    chunks = [x.strip() for x in re.split(r"\n---\n", markdown) if x.strip()]
    side_words = [
        "안되", "안 돼", "어떻게 써", "사용법", "프로그램", "설치",
        "실행", "오류", "에러", "링크", "개발자", "권한", "exe",
    ]
    keep, side = [], []
    for chunk in chunks:
        is_user = chunk.startswith("## User")
        target = side if is_user and any(w.lower() in chunk.lower() for w in side_words) else keep
        target.append(chunk)
    return "\n\n---\n\n".join(keep) + "\n", "\n\n---\n\n".join(side) + "\n"


def copy_text(text):
    root = Tk()
    root.withdraw()
    try:
        root.clipboard_clear()
        root.clipboard_append(text)
        root.update()
    finally:
        root.destroy()


def read_clipboard():
    root = Tk()
    root.withdraw()
    try:
        return root.clipboard_get()
    finally:
        root.destroy()


def save_direct_extract():
    data = eval_js(chatgpt_page()["webSocketDebuggerUrl"], JS_EXTRACT)
    if data["count"] <= 0:
        raise RuntimeError("메시지를 못 찾았습니다. 대화방을 연 뒤 다시 누르세요.")

    base = desktop_dir() / safe_name(data["title"])
    original = Path(str(base) + ".md")
    core = Path(str(base) + "_핵심.md")
    side = Path(str(base) + "_옆길.md")
    core_text, side_text = split_side_talk(data["markdown"])

    original.write_text(data["markdown"], encoding="utf-8")
    core.write_text(core_text, encoding="utf-8")
    side.write_text(side_text, encoding="utf-8")
    copy_text(core_text)
    return data["count"], original, core, side


class App:
    def __init__(self):
        self.root = Tk()
        self.root.title("ChatGPT 전체 대화 추출기")
        self.root.geometry("430x260")
        self.root.resizable(False, False)
        self.watch = False
        self.last_clipboard = ""

        Label(self.root, text="ChatGPT 전체 대화 추출기", font=("Malgun Gothic", 14, "bold")).pack(pady=12)
        self.status = Label(self.root, text="1번으로 Edge를 열고, 대화방을 연 뒤 2번을 누르세요.", font=("Malgun Gothic", 10), wraplength=390)
        self.status.pack(pady=6)

        Button(self.root, text="1. ChatGPT Edge 열기", width=32, height=2, command=self.open_chatgpt).pack(pady=4)
        Button(self.root, text="2. 현재 대화 추출", width=32, height=2, command=self.extract).pack(pady=4)
        Button(self.root, text="복사 감시 시작/중지", width=32, height=2, command=self.toggle_watch).pack(pady=4)
        Button(self.root, text="저장 폴더 열기", width=32, command=self.open_desktop).pack(pady=4)

    def set_status(self, text):
        self.status.config(text=text)

    def run_safe(self, fn):
        def job():
            try:
                fn()
            except Exception as exc:
                self.root.after(0, lambda: messagebox.showerror("오류", str(exc)))
                self.root.after(0, lambda: self.set_status("오류 발생. 내용을 확인하세요."))
        threading.Thread(target=job, daemon=True).start()

    def open_chatgpt(self):
        self.run_safe(lambda: (open_browser(), self.root.after(0, lambda: self.set_status("열린 Edge에서 로그인하고 대화방을 여세요."))))

    def extract(self):
        def work():
            self.root.after(0, lambda: self.set_status("추출 중..."))
            count, original, core, side = save_direct_extract()
            msg = f"{count}개 메시지 저장 완료\n\n{original}\n{core}\n{side}\n\n핵심본은 클립보드에도 복사됨"
            self.root.after(0, lambda: self.set_status("추출 완료. 바탕화면에 저장됨."))
            self.root.after(0, lambda: messagebox.showinfo("완료", msg))
        self.run_safe(work)

    def toggle_watch(self):
        self.watch = not self.watch
        if self.watch:
            self.set_status("복사 감시 중. 복사하면 자동으로 md 저장.")
            self.root.after(700, self.watch_clipboard)
        else:
            self.set_status("복사 감시 중지.")

    def watch_clipboard(self):
        if not self.watch:
            return
        try:
            text = read_clipboard().strip()
            if text and text != self.last_clipboard:
                self.last_clipboard = text
                title = text.splitlines()[0].strip()[:60] or "clipboard"
                md = text if text.lstrip().startswith("#") else f"# {title}\n\n{text}\n"
                out = desktop_dir() / f"clipboard_{time.strftime('%Y%m%d_%H%M%S')}.md"
                out.write_text(md, encoding="utf-8")
                self.set_status(f"저장됨: {out.name}")
        except Exception:
            pass
        self.root.after(700, self.watch_clipboard)

    def open_desktop(self):
        subprocess.Popen(["explorer.exe", str(desktop_dir())])

    def run(self):
        self.root.mainloop()


if __name__ == "__main__":
    App().run()
