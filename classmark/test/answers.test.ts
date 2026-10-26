import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELDS, answeredCount, bucketIndex } from "../src/answers.ts";
import { METRICS, plainRead, position, scoreMetrics, tier, overall } from "../src/stats.ts";
import type { ResponseInput } from "../src/api.ts";

const leet = FIELDS.find((f) => f.key === "leetcode")!.buckets;

test("bucketIndex finds the chip a value falls in", () => {
  assert.equal(bucketIndex(leet, ""), -1);
  assert.equal(bucketIndex(leet, "0"), 0);
  assert.equal(bucketIndex(leet, "37"), 2); // 25–75
  assert.equal(bucketIndex(leet, "75"), 2);
  assert.equal(bucketIndex(leet, "76"), 3);
  assert.equal(bucketIndex(leet, "900"), leet.length - 1);
  assert.equal(bucketIndex(leet, "abc"), -1);
});

test("every bucket's stored value sits inside its own range, and ranges don't overlap", () => {
  for (const f of FIELDS) {
    f.buckets.forEach((b, i) => {
      assert.ok(b.value >= b.min && b.value <= b.max, `${f.key} ${b.label}`);
      assert.equal(bucketIndex(f.buckets, String(b.value)), i, `${f.key} ${b.label}`);
      assert.ok(Number.isInteger(b.value), "database columns are integers");
    });
  }
});

test("answeredCount counts GPA plus every count field", () => {
  assert.deepEqual(answeredCount({}), { answered: 0, total: 8 });
  assert.deepEqual(answeredCount({ gpa: "8.5", leetcode: "50", projects: " " }), { answered: 2, total: 8 });
});

test("tier and position turn percentiles into words", () => {
  assert.equal(tier(90).word, "A strength");
  assert.equal(tier(50).word, "On par");
  assert.equal(tier(10).tone, "low");
  assert.equal(position(80), "top 20%");
  assert.equal(position(50), "around the middle");
  assert.equal(position(25), "bottom 25%");
});

test("plainRead names the strongest area and the biggest gap", () => {
  const me = { school_slug: "x", program: "Computer Science", year: 2, gpa: 3.9, projects: 0, hackathons: null, hackathon_wins: null,
    leetcode: null, internships: null, work_months: null, languages: null } as ResponseInput;
  const peers = { gpa_pct: [50, 60, 70, 80, 90], projects: [1, 2, 3, 4, 5] };
  const results = scoreMetrics(me, 4, peers);
  const read = plainRead(results, overall(results))!;
  assert.match(read.detail!, /strongest area is your GPA \(top/);
  assert.match(read.detail!, /biggest gap is finished projects \(bottom/);
  assert.equal(plainRead(scoreMetrics(null, 4, null), null), null);
  assert.ok(METRICS.every((m) => m.noun.length > 0));
});
