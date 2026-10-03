import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi, emailDomain, schoolForEmail, sessionFromUrlHash, type School } from "../src/api.ts";

const schools: School[] = [
  { slug: "uottawa", name: "University of Ottawa", country: "Canada", gpa_scale: 10, responses: 0, email_domains: ["uottawa.ca"] },
  { slug: "carleton", name: "Carleton University", country: "Canada", gpa_scale: 12, responses: 0, email_domains: ["carleton.ca"] },
];

test("email domains are matched exactly or as a subdomain", () => {
  assert.equal(emailDomain(" Name@UOttawa.CA "), "uottawa.ca");
  assert.equal(emailDomain("not an email"), null);
  assert.equal(schoolForEmail("a@uottawa.ca", schools)?.slug, "uottawa");
  assert.equal(schoolForEmail("a@cmail.carleton.ca", schools)?.slug, "carleton");
  assert.equal(schoolForEmail("a@fakeuottawa.ca", schools), null);
  assert.equal(schoolForEmail("a@uottawa.ca.evil.com", schools), null);
  assert.equal(schoolForEmail("a@gmail.com", schools), null);
});

test("magic-link redirect: session or error from the URL hash", () => {
  const ok = sessionFromUrlHash("#access_token=AAA&expires_at=2000000000&refresh_token=RRR&token_type=bearer&type=magiclink");
  assert.deepEqual(ok, { session: { access_token: "AAA", refresh_token: "RRR", expires_at: 2000000000 } });
  const bad = sessionFromUrlHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  assert.equal(bad?.error, "Email link is invalid or has expired");
  assert.equal(sessionFromUrlHash(""), null);
  assert.equal(sessionFromUrlHash("#section"), null);
});

function fakeFetch(routes: Record<string, (body: any, auth: string) => [number, unknown]>) {
  const calls: { path: string; body: any; auth: string }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://x.supabase.co", "");
    const body = JSON.parse(String(init.body));
    const auth = (init.headers as Record<string, string>).Authorization;
    calls.push({ path, body, auth });
    const route = Object.keys(routes).find((r) => path.startsWith(r));
    const [status, payload] = route ? routes[route](body, auth) : [404, { message: "nope" }];
    return new Response(payload === undefined ? "" : JSON.stringify(payload), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("code sign-in: send, verify, then signed RPC calls", async () => {
  const f = fakeFetch({
    "/auth/v1/otp": () => [200, {}],
    "/auth/v1/verify": (b) => (b.token === "123456" ? [200, { access_token: "T1", refresh_token: "R1", expires_in: 3600 }]
      : [403, { msg: "Token has expired or is invalid" }]),
    "/rest/v1/rpc/whoami": (_b, auth) => [200, auth === "Bearer T1" ? { email: "a@uottawa.ca", verified: true, school_slug: "uottawa" } : null],
    "/auth/v1/logout": () => [204, undefined],
  });
  const api = createApi("https://x.supabase.co/", "anon", f.impl);
  assert.equal(api.isSignedIn(), false);
  assert.equal(await api.whoami(), null, "no call when signed out");

  await api.sendCode(" a@uottawa.ca ", "captcha-token");
  assert.deepEqual(f.calls[0].body, { email: "a@uottawa.ca", create_user: true, gotrue_meta_security: { captcha_token: "captcha-token" } });

  await assert.rejects(api.verifyCode("a@uottawa.ca", "000000"), /wrong or expired/);
  await api.verifyCode("a@uottawa.ca", "123 456");
  assert.equal(api.isSignedIn(), true);
  assert.equal((await api.whoami())?.school_slug, "uottawa");

  await api.signOut();
  assert.equal(api.isSignedIn(), false);
  assert.equal(f.calls.at(-1)!.path, "/auth/v1/logout");
  assert.equal(f.calls.at(-1)!.auth, "Bearer T1");
});

test("signed-out calls that need an account fail before hitting the network", async () => {
  const f = fakeFetch({});
  const api = createApi("https://x.supabase.co", "anon", f.impl);
  await assert.rejects(api.peerStats("uottawa", null, null), /Sign in with your school email/);
  await assert.rejects(api.saveMyResponse({} as never), /Sign in/);
  assert.equal(f.calls.length, 0);
});

test("refused sign-ups and rate limits get readable messages", async () => {
  const f = fakeFetch({
    "/auth/v1/otp": (b) => (b.email.endsWith("gmail.com")
      ? [500, { code: 500, error_code: "unexpected_failure", msg: "Database error saving new user" }]
      : [429, { msg: "email rate limit exceeded" }]),
  });
  const api = createApi("https://x.supabase.co", "anon", f.impl);
  await assert.rejects(api.sendCode("a@gmail.com"), /Use your school email/);
  await assert.rejects(api.sendCode("a@uottawa.ca"), /Wait a minute/);
});

test("expired session refreshes, and a failed refresh signs out", async () => {
  let refreshOk = true;
  const f = fakeFetch({
    "/auth/v1/verify": () => [200, { access_token: "OLD", refresh_token: "R", expires_at: 1 }],
    "/auth/v1/token": () => (refreshOk ? [200, { access_token: "NEW", refresh_token: "R2", expires_in: 3600 }] : [400, { msg: "bad" }]),
    "/rest/v1/rpc/whoami": (_b, auth) => [200, { email: auth, verified: true, school_slug: "uottawa" }],
  });
  const api = createApi("https://x.supabase.co", "anon", f.impl);
  await api.verifyCode("a@uottawa.ca", "123456");
  assert.equal((await api.whoami())?.email, "Bearer NEW");

  const api2 = createApi("https://x.supabase.co", "anon", f.impl);
  await api2.verifyCode("a@uottawa.ca", "123456");
  refreshOk = false;
  assert.equal(await api2.whoami(), null);
  assert.equal(api2.isSignedIn(), false);
});
