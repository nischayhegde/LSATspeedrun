"""Screenshot the record line under an armed comparative gate.

One browser, closed on both the success and the failure path. Signs itself in
against the local development auth route for the local demo learner, arms the
gate the way a student does (pressing "Use it"), and captures the panel.
"""
from __future__ import annotations

import argparse
import sys

import requests
from playwright.sync_api import sync_playwright

API = "http://127.0.0.1:5001/v1"
APP = "http://127.0.0.1:5173"
OUT = "/Users/alan/LSATspeedrun/.strategy-shots"


def sign_in(email: str) -> list[dict]:
    """Local dev-auth only; the route refuses to exist outside development."""
    client = requests.Session()
    response = client.post(f"{API}/auth/dev", json={"email": email, "display_name": "Record Line"})
    response.raise_for_status()
    return [
        {
            "name": cookie.name,
            "value": cookie.value,
            "domain": "127.0.0.1",
            "path": "/",
            "httpOnly": False,
            "secure": False,
            "sameSite": "Lax",
        }
        for cookie in client.cookies
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session", required=True)
    parser.add_argument("--email", default="recordline@localhost.test")
    parser.add_argument("--prefix", default="recordline")
    parser.add_argument(
        "--progress",
        action="store_true",
        help="Capture the dashboard's strategy panel instead, to compare the two surfaces.",
    )
    args = parser.parse_args()

    cookies = sign_in(args.email)
    print("signed in, cookies:", [cookie["name"] for cookie in cookies])

    browser = None
    playwright = None
    try:
        playwright = sync_playwright().start()
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 1600})
        context.add_cookies(cookies)
        page = context.new_page()
        page.on("console", lambda message: print(f"  console[{message.type}]: {message.text}"[:200]))

        def dismiss_story() -> None:
            """A story beat can be waiting, and it is modal over everything."""
            for _ in range(4):
                overlay = page.locator(".cutscene-overlay")
                if not overlay.count():
                    return
                for selector in (".cutscene-defer", ".cutscene-continue"):
                    button = overlay.locator(selector)
                    if button.count():
                        button.first.click()
                        page.wait_for_timeout(1200)
                        break
                else:
                    return

        if args.progress:
            page.goto(f"{APP}/progress", wait_until="networkidle")
            page.wait_for_timeout(3000)
            dismiss_story()
            tab = page.locator("#dash-tab-methods")
            print("methods tab:", tab.count())
            if tab.count():
                tab.first.click()
                page.wait_for_timeout(2000)
            roll_up = page.locator(".strategy-results-detail summary")
            if roll_up.count():
                roll_up.first.click()
                page.wait_for_timeout(1200)
            table = page.locator(".strategy-results-table > div")
            print("roll-up rows:", table.count())
            for index in range(table.count()):
                text = table.nth(index).inner_text().replace("\n", " | ")
                if "passages" in text or "Approach" in text:
                    print("ROW:", text)
            page.screenshot(path=f"{OUT}/{args.prefix}-progress.png", full_page=True)
            detail = page.locator(".strategy-results-detail")
            if detail.count():
                detail.first.screenshot(path=f"{OUT}/{args.prefix}-rollup.png")
            print("captured progress")
            return 0

        page.goto(f"{APP}/cases/{args.session}", wait_until="networkidle")
        page.wait_for_timeout(2500)
        dismiss_story()
        page.screenshot(path=f"{OUT}/{args.prefix}-0-loaded.png")
        print("loaded:", page.url)

        use_it = page.get_by_role("button", name="Use it")
        if not use_it.count():
            use_it = page.locator("button", has_text="USE IT")
        print("use-it buttons:", use_it.count())
        if use_it.count():
            use_it.first.click()
            page.wait_for_timeout(3000)

        record = page.locator(".sg-record")
        print("record nodes:", record.count())
        if record.count():
            print("RECORD TEXT:", record.first.inner_text().replace("\n", " "))
            record.first.scroll_into_view_if_needed()
            page.wait_for_timeout(600)
            record.first.screenshot(path=f"{OUT}/{args.prefix}-2-line.png")

        panel = page.locator("[class*='sg-panel']")
        if panel.count():
            panel.first.screenshot(path=f"{OUT}/{args.prefix}-1-panel.png")
        page.screenshot(path=f"{OUT}/{args.prefix}-3-screen.png")
        print("captured")
        return 0 if record.count() else 1
    finally:
        if browser is not None:
            browser.close()
        if playwright is not None:
            playwright.stop()


if __name__ == "__main__":
    sys.exit(main())
