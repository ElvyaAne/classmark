"""End-to-end browser test: real SQL functions behind the mock API, real built app, Chromium.

Run via test/e2e/run.sh. Seeds 6 anonymous peers at uOttawa (CS & Mathematics, year 2),
then walks through what a new student does.
"""
import re, sys
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "test/e2e/shots"
errors: list[str] = []

def step(msg):
    print("ok ", msg, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1100, "height": 900})
    page = ctx.new_page()
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/?school=uottawa")
    expect(page.get_by_role("heading", name="Classmark", level=1)).to_be_visible()
    expect(page.locator(".chip")).to_have_text("6 peers in this group")
    expect(page.locator("#f-school")).to_have_value("uottawa")
    expect(page.get_by_text("Add your numbers to see your percentiles")).to_be_visible()
    expect(page.locator(".big")).to_have_text("—")
    step("first visit: school from link, 6 peers, no standing yet")

    # distributions visible before submitting (6 peers >= 5)
    expect(page.locator(".row").first.locator("circle")).to_have_count(6)
    step("peer distribution dots render before you submit")

    # fill the form with the test case
    page.select_option("#pf-school", "uottawa")
    page.select_option("#pf-program", "CS & Mathematics")
    page.select_option("#pf-year", "2")
    for field, val in {"gpa": "8.82", "projects": "2", "hackathons": "1", "hackathon_wins": "0", "leetcode": "29",
                       "internships": "0", "work_months": "5", "languages": "6"}.items():
        page.fill(f"#pf-{field}", val)

    # client-side validation
    page.fill("#pf-gpa", "11")
    page.get_by_role("button", name="Save and see my percentiles").click()
    expect(page.get_by_role("alert")).to_contain_text("can't be above 10")
    page.fill("#pf-gpa", "8.82")
    step("GPA above the school's scale is caught before saving")

    page.get_by_role("button", name="Save and see my percentiles").click()
    expect(page.get_by_text("Saved. Your percentiles are above.")).to_be_visible()
    expect(page.locator(".big")).to_have_text(re.compile(r"^\d+(st|nd|rd|th)$"))
    expect(page.locator("#f-program")).to_have_value("CS & Mathematics")
    expect(page.locator(".chip")).to_have_text("6 peers in this group")
    standing = page.locator(".big").inner_text()
    step(f"saved: overall standing {standing}, filters snap to your group")

    cgpa_row = page.locator(".row").filter(has_text="CGPA")
    expect(cgpa_row.locator(".pct b")).to_have_text(re.compile(r"\d+(st|nd|rd|th)"))
    expect(cgpa_row.locator(".val")).to_have_text("8.82 / 10")
    expect(page.locator(".moves li").first).to_be_visible()
    page.screenshot(path=f"{SHOTS}/desktop-light.png", full_page=True)
    step("per-metric percentiles and next moves render")

    # reload keeps the same anonymous identity
    page.reload()
    expect(page.get_by_role("button", name="Update my numbers")).to_be_visible()
    expect(page.locator("#pf-leetcode")).to_have_value("29")
    step("reload: same browser keeps your response")

    page.fill("#pf-leetcode", "60")
    page.get_by_role("button", name="Update my numbers").click()
    expect(page.get_by_text("Updated.")).to_be_visible()
    expect(page.locator(".row").filter(has_text="LeetCode").locator(".val")).to_have_text("60")
    step("update changes your numbers in place")

    page.select_option("#f-school", "carleton")
    expect(page.locator(".chip")).to_have_text("0 peers in this group")
    expect(page.locator(".big")).to_have_text("—")
    page.select_option("#f-school", "all")
    page.select_option("#f-program", "all")
    page.select_option("#f-year", "all")
    expect(page.locator(".chip")).to_have_text("6 peers in this group")
    step("filters: other school is empty, all-schools works")

    page.get_by_text("School not listed?").click()
    page.fill("#rs-name", "York University")
    page.select_option("#rs-scale", "9")
    page.get_by_role("button", name="Request school").click()
    expect(page.get_by_text("Requested. York University will appear once it's approved.")).to_be_visible()
    expect(page.locator("#f-school option[value=york]")).to_have_count(0)
    step("school request accepted and hidden until approved")

    page.get_by_role("button", name="Delete my data").click()
    page.get_by_role("button", name="Delete", exact=True).click()
    expect(page.get_by_text("Your numbers were deleted.")).to_be_visible()
    expect(page.get_by_text("Add your numbers to see your percentiles")).to_be_visible()
    step("delete removes your response")

    # mobile, dark, someone new arriving from a share link
    m = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", is_mobile=True)
    mp = m.new_page()
    mp.on("pageerror", lambda e: errors.append(str(e)))
    mp.goto(BASE + "/?school=carleton")
    expect(mp.locator("#f-school")).to_have_value("carleton")
    expect(mp.locator(".standing-text p")).to_contain_text("Percentiles unlock once 5 peers")
    overflow = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    assert not overflow, "page scrolls sideways on mobile"
    mp.goto(BASE + "/?school=uottawa")
    expect(mp.locator(".chip")).to_have_text("6 peers in this group")
    mp.screenshot(path=f"{SHOTS}/mobile-dark.png", full_page=True)
    step("mobile + dark: share link, no sideways scroll")

    browser.close()

real_errors = [e for e in errors if "fonts.g" not in e and "net::ERR" not in e]
if real_errors:
    print("console errors:", *real_errors, sep="\n  ")
    sys.exit(1)
print("ALL E2E TESTS PASSED")
