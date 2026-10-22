import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findSecretKeys, secretKeyProblem } from "../src/keys.ts";

const jwt = (claims: object) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.c2ln`;

test("public keys pass, secret keys are caught", () => {
  assert.equal(secretKeyProblem(jwt({ iss: "supabase", role: "anon" })), null);
  assert.equal(secretKeyProblem("sb_publishable_abc123"), null);
  assert.equal(secretKeyProblem(""), null);
  assert.match(secretKeyProblem(jwt({ iss: "supabase", role: "service_role" }))!, /service_role/);
  assert.match(secretKeyProblem("sb_secret_abc123")!, /secret/);
});

test("secret keys are found inside text", () => {
  assert.deepEqual(findSecretKeys(`anon: ${jwt({ role: "anon" })}`), []);
  assert.equal(findSecretKeys(`SUPABASE_KEY=${jwt({ role: "service_role" })}\nother=sb_secret_xyz`).length, 2);
});

test("no secret Supabase key is committed anywhere in the repo", () => {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  const leaks: string[] = [];
  for (const f of files) {
    if (/\.(png|jpe?g|gif|ico|woff2?|bundle)$/i.test(f)) continue;
    for (const problem of findSecretKeys(readFileSync(`${root}/${f}`, "utf8"))) leaks.push(`${f}: ${problem}`);
  }
  assert.deepEqual(leaks, []);
});
