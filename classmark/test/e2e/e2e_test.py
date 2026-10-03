"""End-to-end browser test: real SQL functions behind the mock API, real built app, Chromium.

Run via test/e2e/run.sh. Seeds 6 verified peers at uOttawa (CS & Mathematics, year 2), then
walks through what a visitor sees signed out, and what a student does after verifying.
"""
import re, sys
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8787"
SHOTS = sys.argv[2] if len(sys.argv) > 2 else "test/e2e/shots"
errors: list[str] = []
EMAIL = "new.student@uottawa.ca"

def step(msg):
    print("ok ", msg, flush=True)

def watch(page):
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1100, "height": 900})
    page = ctx.new_page()
    watch(page)
    # ------------------------------------------------------------ signed out: average student only
    with page.expect_response(lambda r: "/rpc/average_student" in r.url) as first_avg:
        page.goto(BASE + "/?school=uottawa")
    expect(page.get_by_role("heading", name="Classmark", level=1)).to_be_visible()
    expect(page.get_by_role("heading", name="The average student")).to_be_visible()
    expect(page.locator(".chip")).to_have_text("6 students in this group")
    expect(page.locator("#f-school")).to_have_value("uottawa")
    cgpa = page.locator(".row").filter(has_text="CGPA")
    expect(cgpa.locator(".val")).to_have_text(re.compile(r"^\d+\.\d\d / 10$"))
    expect(page.locator(".row circle")).to_have_count(0)
    expect(page.locator("#pf-gpa")).to_have_count(0)
    expect(page.locator(".big")).to_have_count(0)
    assert "[" not in first_avg.value.text(), "average_student returned lists of values"
    csp = page.request.get(BASE + "/").headers.get("content-security-policy", "")
    assert "frame-ancestors 'none'" in csp, "security headers missing"
    step("signed out: only the average student, no dots, no form, no lists of values in the API")

    r = page.request.post(BASE + "/rest/v1/rpc/peer_stats", data={"p_school": "uottawa"},
                          headers={"apikey": "test-anon-key", "Authorization": "Bearer test-anon-key"})
    assert r.status in (401, 403), f"anon peer_stats returned {r.status}"
    step("signed out: calling peer_stats directly is refused")

    # ------------------------------------------------------------ sign in with a school email
    page.fill("#si-email", "someone@gmail.com")
    page.get_by_role("button", name="Email me a code").click()
    expect(page.get_by_role("alert")).to_contain_text("Use your school email")
    step("non-school email is turned away before any code is sent")

    page.fill("#si-email", EMAIL)
    expect(page.get_by_text("You'll be compared within University of Ottawa.")).to_be_visible()
    page.get_by_role("button", name="Email me a code").click()
    expect(page.get_by_text("We emailed a code to")).to_be_visible()
    code = page.request.get(f"{BASE}/__test/otp?email={EMAIL}").json()["code"]
    assert re.fullmatch(r"\d{6}", code)
    page.fill("#si-code", "000000" if code != "000000" else "111111")
    page.get_by_role("button", name="Verify").click()
    expect(page.get_by_role("alert")).to_contain_text("wrong or expired")
    step("wrong code is rejected")

    page.fill("#si-code", code)
    page.get_by_role("button", name="Verify").click()
    expect(page.get_by_role("heading", name="Overall standing")).to_be_visible()
    expect(page.get_by_text("You're verified. Add your numbers")).to_be_visible()
    expect(page.locator(".chip")).to_have_text("6 peers in this group")
    expect(page.locator("#pf-school")).to_have_text("University of Ottawa")
    expect(page.get_by_text(f"Signed in as {EMAIL}")).to_be_visible()
    expect(page.locator(".row").first.locator("circle")).to_have_count(6)
    step("verified: full comparison, school locked to the email, peer dots visible")

    # ------------------------------------------------------------ save numbers
    page.select_option("#pf-program", "CS & Mathematics")
    page.select_option("#pf-year", "2")
    for field, val in {"gpa": "8.82", "projects": "2", "hackathons": "1", "hackathon_wins": "0", "leetcode": "29",
                       "internships": "0", "work_months": "5", "languages": "6"}.items():
        page.fill(f"#pf-{field}", val)

    page.fill("#pf-gpa", "11")
    page.get_by_role("button", name="Save and see my percentiles").click()
    expect(page.get_by_role("alert")).to_contain_text("can't be above 10")
    page.fill("#pf-gpa", "8.82")
    step("GPA above the school's scale is caught before saving")

    page.get_by_role("button", name="Save and see my percentiles").click()
    expect(page.get_by_text("Saved. Your percentiles are above.")).to_be_visible()
    expect(page.locator(".big")).to_have_text(re.compile(r"^\d+(st|nd|rd|th)$"))
    expect(page.locator("#f-program")).to_have_value("CS & Mathematics")
    standing = page.locator(".big").inner_text()
    step(f"saved: overall standing {standing}, filters snap to your group")

    cgpa = page.locator(".row").filter(has_text="CGPA")
    expect(cgpa.locator(".pct b")).to_have_text(re.compile(r"\d+(st|nd|rd|th)"))
    expect(cgpa.locator(".val")).to_have_text("8.82 / 10")
    expect(page.locator(".moves li").first).to_be_visible()
    page.evaluate("window.scrollTo(0, 0)")
    page.screenshot(path=f"{SHOTS}/desktop-light.png", full_page=True)
    step("per-metric percentiles and next moves render")

    page.reload()
    expect(page.get_by_role("button", name="Update my numbers")).to_be_visible()
    expect(page.locator("#pf-leetcode")).to_have_value("29")
    step("reload: still signed in, numbers kept")

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
    page.fill("#rs-domain", "student@yorku.ca")
    page.select_option("#rs-scale", "9")
    page.get_by_role("button", name="Request school").click()
    expect(page.get_by_text("Requested. York University will appear once it's approved.")).to_be_visible()
    expect(page.locator("#f-school option[value=york]")).to_have_count(0)
    step("school request (with email domain) accepted and hidden until approved")

    page.get_by_role("button", name="Delete my numbers").click()
    page.get_by_role("button", name="Delete", exact=True).click()
    expect(page.get_by_text("Your numbers were deleted.")).to_be_visible()
    expect(page.get_by_text("You're verified. Add your numbers")).to_be_visible()
    step("delete removes your numbers")

    page.get_by_role("button", name="Sign out").click()
    expect(page.get_by_role("heading", name="The average student")).to_be_visible()
    expect(page.locator("#pf-gpa")).to_have_count(0)
    step("sign out: back to the average student")

    # ------------------------------------------------------------ magic link instead of the code
    page.fill("#si-email", EMAIL)
    page.get_by_role("button", name="Email me a code").click()
    expect(page.get_by_text("We emailed a code to")).to_be_visible()
    uid = page.request.get(f"{BASE}/__test/confirm?email={EMAIL}").json()["user_id"]
    page.goto(f"{BASE}/#access_token=u:{uid}&refresh_token=r:{uid}&expires_in=3600&token_type=bearer&type=magiclink")
    expect(page.get_by_role("heading", name="Overall standing")).to_be_visible()
    assert "access_token" not in page.url, "tokens left in the address bar"
    step("magic link signs you in and clears the tokens from the URL")

    page.get_by_role("button", name="Delete my account").click()
    page.get_by_role("button", name="Delete account").click()
    expect(page.get_by_text("Your account and numbers were deleted.")).to_be_visible()
    expect(page.get_by_role("heading", name="The average student")).to_be_visible()
    step("delete account signs you out")

    # ------------------------------------------------------------ mobile, dark, from a share link
    m = browser.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark", is_mobile=True)
    mp = m.new_page()
    watch(mp)
    mp.goto(BASE + "/?school=carleton")
    expect(mp.locator("#f-school")).to_have_value("carleton")
    expect(mp.locator(".standing-text p")).to_contain_text("Averages unlock once 5 students")
    overflow = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    assert not overflow, "page scrolls sideways on mobile"
    mp.goto(BASE + "/?school=uottawa")
    expect(mp.locator(".chip")).to_have_text("6 students in this group")
    overflow = mp.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    assert not overflow, "page scrolls sideways on mobile (averages)"
    mp.screenshot(path=f"{SHOTS}/mobile-dark.png", full_page=True)
    step("mobile + dark: share link, no sideways scroll")

    browser.close()

real_errors = [e for e in errors if "fonts.g" not in e and "net::ERR" not in e and "Failed to load resource" not in e]
if real_errors:
    print("console errors:", *real_errors, sep="\n  ")
    sys.exit(1)
print("ALL E2E TESTS PASSED")
