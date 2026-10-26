// Quick-pick ranges for the profile form. Students tap a range instead of recalling an exact number;
// the range's representative value is what gets stored, so the percentile math is unchanged.
// Anyone who knows the exact number can still type it.

export type CountField = "projects" | "hackathons" | "hackathon_wins" | "leetcode" | "internships" | "work_months" | "languages";

export interface Bucket {
  label: string;
  /** inclusive range this chip covers */
  min: number;
  max: number;
  /** value stored when the chip is tapped */
  value: number;
}

export interface FieldSpec {
  key: CountField;
  label: string;
  hint: string;
  buckets: Bucket[];
  /** shown in the quick form; the rest sit under "Add more" */
  core: boolean;
}

const small = (top: number): Bucket[] => [
  ...Array.from({ length: top }, (_, i) => ({ label: String(i), min: i, max: i, value: i })),
  { label: `${top}+`, min: top, max: Infinity, value: top },
];

export const FIELDS: FieldSpec[] = [
  { key: "projects", label: "Finished projects", hint: "Things you built outside class and got working", buckets: small(5), core: true },
  { key: "internships", label: "Tech internships / co-ops", hint: "Completed terms", buckets: small(3), core: true },
  {
    key: "leetcode", label: "LeetCode solved", hint: "A rough range is fine", core: true,
    buckets: [
      { label: "None", min: 0, max: 0, value: 0 },
      { label: "Under 25", min: 1, max: 24, value: 12 },
      { label: "25–75", min: 25, max: 75, value: 50 },
      { label: "75–150", min: 76, max: 150, value: 110 },
      { label: "150–300", min: 151, max: 300, value: 225 },
      { label: "300+", min: 301, max: Infinity, value: 350 },
    ],
  },
  { key: "hackathons", label: "Hackathons attended", hint: "", buckets: small(5), core: false },
  { key: "hackathon_wins", label: "Hackathon placements", hint: "Prizes or top finishes", buckets: small(3), core: false },
  {
    key: "work_months", label: "Other work experience", hint: "Any non-tech job, roughly", core: false,
    buckets: [
      { label: "None", min: 0, max: 0, value: 0 },
      { label: "Under 6 mo", min: 1, max: 5, value: 3 },
      { label: "6–12 mo", min: 6, max: 12, value: 9 },
      { label: "1–2 yrs", min: 13, max: 24, value: 18 },
      { label: "2+ yrs", min: 25, max: Infinity, value: 30 },
    ],
  },
  { key: "languages", label: "Programming languages you can build with", hint: "", buckets: small(6), core: false },
];

/** Which chip a stored or typed value falls into, or -1 when blank or out of every range. */
export function bucketIndex(buckets: readonly Bucket[], raw: string): number {
  if (raw.trim() === "") return -1;
  const v = Number(raw);
  if (!Number.isFinite(v)) return -1;
  return buckets.findIndex((b) => v >= b.min && v <= b.max);
}

/** How many of the scored questions (GPA plus the count fields) have an answer. */
export function answeredCount(draft: Record<string, string>): { answered: number; total: number } {
  const keys = ["gpa", ...FIELDS.map((f) => f.key)];
  return { answered: keys.filter((k) => (draft[k] ?? "").trim() !== "").length, total: keys.length };
}
