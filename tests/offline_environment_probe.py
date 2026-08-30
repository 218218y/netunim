from __future__ import annotations

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import websocket

from browser_harness import BrowserSession, find_browser


def main() -> int:
    node = shutil.which("node")
    if not node:
        print("ERROR: Node is not available in the offline PATH")
        return 2
    version = subprocess.run([node, "--version"], capture_output=True, text=True)
    if version.returncode:
        print("ERROR: offline Node could not be executed")
        return 2

    print(f"offline Node: {node} ({version.stdout.strip()})")
    print(f"offline websocket-client: {Path(websocket.__file__).resolve()} ({websocket.__version__})")

    browser = find_browser()
    if not browser:
        print("BROWSER_RUNTIME_UNAVAILABLE: no Chrome/Edge/Chromium executable was found")
        print("Set NETUNIM_BROWSER to an explicit test-browser executable if one is available.")
        return 3
    print(f"browser candidate: {browser}")

    source = Path(tempfile.mkdtemp(prefix="netunim-browser-probe-source-"))
    try:
        (source / "index.html").write_text("<!doctype html><meta charset=utf-8><title>probe</title><p>ok</p>\n", encoding="utf-8")
        try:
            with BrowserSession(source, "offline-probe", instrument=False):
                pass
        except (RuntimeError, OSError) as exc:
            message = str(exc)
            if "ERR_BLOCKED_BY_ADMINISTRATOR" in message:
                print("BROWSER_RUNTIME_UNAVAILABLE: host browser policy blocks localhost navigation")
                print("Use an unmanaged test browser via NETUNIM_BROWSER, or run `npm run test:chat` for core repair checks.")
                return 3
            print(f"ERROR: browser runtime probe failed: {message}")
            return 4
    finally:
        shutil.rmtree(source, ignore_errors=True)

    print("browser runtime: localhost/CDP navigation OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
