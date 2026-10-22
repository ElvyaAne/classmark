// Supabase has two kinds of key. The public one (anon / sb_publishable_…) is meant to ship in the
// site's JavaScript: it can only call the functions the database grants. The secret one
// (service_role / sb_secret_…) skips every privacy rule and can read every student's numbers and
// email. It must never reach the browser, the repo, or a VITE_ variable.
//
// Runs in Node only (the build in vite.config.ts, and the tests), never in the browser.

/** Why this key must not be made public, or null when it is a public key. */
export function secretKeyProblem(key: string): string | null {
  const k = key.trim();
  if (/^sb_secret_/.test(k)) return "this is a Supabase secret key (sb_secret_…)";
  const parts = k.split(".");
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      if (claims && typeof claims.role === "string" && claims.role !== "anon") {
        return `this key has the "${claims.role}" role`;
      }
    } catch {
      /* not a JWT */
    }
  }
  return null;
}

/** Every Supabase-looking key in a piece of text that must not be public. */
export function findSecretKeys(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(/sb_secret_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    const problem = secretKeyProblem(m[0]);
    if (problem) found.push(problem);
  }
  return found;
}
