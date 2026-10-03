import { test } from "node:test";
import assert from "node:assert/strict";
import { percentile, quantile, ordinal, scoreMetrics, overall, gaps, METRICS } from "../src/stats.ts";
import type { ResponseInput } from "../src/api.ts";

test("percentile uses mid-rank for ties", () => {
  assert.equal(percentile([1, 2, 3, 4], 5), 100);
  assert.equal(percentile([1, 2, 3, 4], 0), 0);
  assert.equal(percentile([1, 2, 2, 4], 2), 50); // 1 below + half of 2 ties = 2/4
  assert.equal(percentile([0, 1, 2, 3, 4], 2), 50);
});

test("quantile interpolates", () => {
  assert.equal(quantile([0, 10], 0.5), 5);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.75), 4);
  assert.equal(quantile([7], 0.9), 7);
});

test("ordinal suffixes", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal),
    ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "101st", "111th"]);
});

const me: ResponseInput = {
  school_slug: "uottawa", program: "CS & Mathematics", year: 2, gpa: 8.82, projects: 2, hackathons: 1,
  hackathon_wins: 0, leetcode: 29, internships: 0, work_months: 5, languages: 6,
};

test("GPA is normalised against the school's scale", () => {
  const gpa = METRICS.find((m) => m.key === "gpa_pct")!;
  assert.equal(gpa.value(me, 10), 88.2);
  assert.equal(gpa.value({ ...me, gpa: 3.5 }, 4), 87.5);
});

test("scoring hides metrics with fewer than 5 peers and averages the rest", () => {
  const results = scoreMetrics(me, 10, {
    gpa_pct: [60, 75, 80, 85, 91],
    projects: [0, 1, 2, 3, 4],
    leetcode: null,
    languages: [2, 3], // too few: treated as hidden
  });
  const by = Object.fromEntries(results.map((r) => [r.metric.key, r]));
  assert.equal(by.gpa_pct.percentile, 80);
  assert.equal(by.projects.percentile, 50);
  assert.equal(by.leetcode.percentile, null);
  assert.equal(by.languages.percentile, null);
  assert.equal(by.projects.median, 2);
  assert.equal(overall(results), 65);
  assert.deepEqual(gaps(results).map((g) => g.metric.key), ["projects"]);
});

test("no profile yet means no percentiles but distributions still show", () => {
  const results = scoreMetrics(null, 10, { projects: [0, 1, 2, 3, 4] });
  assert.equal(results.find((r) => r.metric.key === "projects")!.percentile, null);
  assert.deepEqual(results.find((r) => r.metric.key === "projects")!.peers, [0, 1, 2, 3, 4]);
  assert.equal(overall(results), null);
});
