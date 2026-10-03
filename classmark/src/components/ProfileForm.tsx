import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { PROGRAMS, type Program, type ResponseInput, type School } from "../api";

interface Props {
  /** The student's school, fixed by their verified email. */
  school: School;
  initial: ResponseInput | null;
  saving: boolean;
  onSave: (r: ResponseInput) => void;
  onDelete: (() => void) | null;
}

const NUM_FIELDS: { key: keyof ResponseInput; label: string; hint?: string }[] = [
  { key: "projects", label: "Finished projects", hint: "Outside of class assignments" },
  { key: "hackathons", label: "Hackathons attended" },
  { key: "hackathon_wins", label: "Hackathon placements", hint: "Prizes or top finishes" },
  { key: "leetcode", label: "LeetCode solved" },
  { key: "internships", label: "Tech internships / co-ops", hint: "Completed terms" },
  { key: "work_months", label: "Other work (months)", hint: "Any non-tech job" },
  { key: "languages", label: "Programming languages known" },
];

type Draft = Record<string, string>;

function toDraft(r: ResponseInput | null): Draft {
  const d: Draft = { program: r?.program ?? "Computer Science", year: String(r?.year ?? 2), gpa: r?.gpa == null ? "" : String(r.gpa) };
  for (const f of NUM_FIELDS) d[f.key] = r?.[f.key] == null ? "" : String(r[f.key]);
  return d;
}

export function ProfileForm({ school, initial, saving, onSave, onDelete }: Props) {
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setD(toDraft(initial)), [initial]);

  const scale = school.gpa_scale;
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = (v: string) => (v.trim() === "" ? null : Number(v));
    const r: ResponseInput = {
      school_slug: school.slug, program: d.program as Program, year: Number(d.year), gpa: n(d.gpa),
      projects: n(d.projects), hackathons: n(d.hackathons), hackathon_wins: n(d.hackathon_wins), leetcode: n(d.leetcode),
      internships: n(d.internships), work_months: n(d.work_months), languages: n(d.languages),
    };
    const nums = Object.entries(r).filter(([k]) => k !== "school_slug" && k !== "program");
    if (nums.some(([, v]) => v != null && (!Number.isFinite(v as number) || (v as number) < 0)))
      return setError("Numbers can't be negative.");
    if (r.gpa != null && r.gpa > scale) return setError(`GPA can't be above ${scale} at this school.`);
    if (r.hackathon_wins != null && r.hackathons != null && r.hackathon_wins > r.hackathons)
      return setError("Placements can't be more than hackathons attended.");
    setError(null);
    onSave(r);
  }

  return (
    <form className="grid-form" onSubmit={submit} noValidate>
      <div className="field">
        <span className="label" id="pf-school-label">School</span>
        <span className="locked" aria-labelledby="pf-school-label" id="pf-school">{school.name}</span>
      </div>
      <div className="field">
        <label htmlFor="pf-program">Program</label>
        <select id="pf-program" value={d.program} onChange={set("program")}>
          {PROGRAMS.map((p) => <option key={p}>{p}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="pf-year">Year of study</label>
        <select id="pf-year" value={d.year} onChange={set("year")}>
          {[1, 2, 3, 4, 5, 6].map((y) => <option key={y} value={y}>{y === 6 ? "6+" : y}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="pf-gpa">CGPA (out of {scale})</label>
        <input id="pf-gpa" type="number" inputMode="decimal" step="0.01" min={0} max={scale} value={d.gpa} onChange={set("gpa")} />
      </div>
      {NUM_FIELDS.map((f) => (
        <div className="field" key={f.key}>
          <label htmlFor={`pf-${f.key}`}>{f.label}</label>
          <input id={`pf-${f.key}`} type="number" inputMode="numeric" min={0} step={1} value={d[f.key]} onChange={set(f.key)}
            placeholder={f.hint ?? ""} />
        </div>
      ))}
      <div className="actions span-all">
        <button type="submit" disabled={saving}>{saving ? "Saving…" : initial ? "Update my numbers" : "Save and see my percentiles"}</button>
        {onDelete && !confirmDelete && <button type="button" className="ghost" onClick={() => setConfirmDelete(true)}>Delete my numbers</button>}
        {onDelete && confirmDelete && (
          <span className="confirm">
            Delete your numbers for good?
            <button type="button" className="danger" onClick={() => { setConfirmDelete(false); onDelete(); }}>Delete</button>
            <button type="button" className="ghost" onClick={() => setConfirmDelete(false)}>Keep</button>
          </span>
        )}
        {error && <span className="status error" role="alert">{error}</span>}
      </div>
    </form>
  );
}
