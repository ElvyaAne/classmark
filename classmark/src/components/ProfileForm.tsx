import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { PROGRAMS, type Program, type ResponseInput, type School } from "../api";

interface Props {
  schools: School[];
  initial: ResponseInput | null;
  defaultSchool: string;
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

function toDraft(r: ResponseInput | null, school: string): Draft {
  const d: Draft = { school_slug: r?.school_slug ?? school, program: r?.program ?? "Computer Science", year: String(r?.year ?? 2), gpa: r?.gpa == null ? "" : String(r.gpa) };
  for (const f of NUM_FIELDS) d[f.key] = r?.[f.key] == null ? "" : String(r[f.key]);
  return d;
}

export function ProfileForm({ schools, initial, defaultSchool, saving, onSave, onDelete }: Props) {
  const [d, setD] = useState<Draft>(() => toDraft(initial, defaultSchool));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setD(toDraft(initial, defaultSchool)), [initial, defaultSchool]);

  const scale = schools.find((s) => s.slug === d.school_slug)?.gpa_scale;
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = (v: string) => (v.trim() === "" ? null : Number(v));
    const r: ResponseInput = {
      school_slug: d.school_slug, program: d.program as Program, year: Number(d.year), gpa: n(d.gpa),
      projects: n(d.projects), hackathons: n(d.hackathons), hackathon_wins: n(d.hackathon_wins), leetcode: n(d.leetcode),
      internships: n(d.internships), work_months: n(d.work_months), languages: n(d.languages),
    };
    if (!r.school_slug) return setError("Pick your school.");
    if (r.gpa != null && scale != null && r.gpa > scale) return setError(`GPA can't be above ${scale} at this school.`);
    if (r.hackathon_wins != null && r.hackathons != null && r.hackathon_wins > r.hackathons)
      return setError("Placements can't be more than hackathons attended.");
    setError(null);
    onSave(r);
  }

  return (
    <form className="grid-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="pf-school">School</label>
        <select id="pf-school" value={d.school_slug} onChange={set("school_slug")} required>
          <option value="" disabled>Choose…</option>
          {schools.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </select>
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
        <label htmlFor="pf-gpa">CGPA{scale ? ` (out of ${scale})` : ""}</label>
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
        {onDelete && !confirmDelete && <button type="button" className="ghost" onClick={() => setConfirmDelete(true)}>Delete my data</button>}
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
