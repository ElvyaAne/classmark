import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { PROGRAMS, type Program, type ResponseInput, type School } from "../api";
import { FIELDS, answeredCount, bucketIndex, type FieldSpec } from "../answers";

interface Props {
  /** The student's school, fixed by their verified email. */
  school: School;
  initial: ResponseInput | null;
  saving: boolean;
  onSave: (r: ResponseInput) => void;
  onDelete: (() => void) | null;
}

type Draft = Record<string, string>;

function toDraft(r: ResponseInput | null): Draft {
  const d: Draft = { program: r?.program ?? "Computer Science", year: String(r?.year ?? 2), gpa: r?.gpa == null ? "" : String(r.gpa) };
  for (const f of FIELDS) d[f.key] = r?.[f.key] == null ? "" : String(r[f.key]);
  return d;
}

/** One question answered by tapping a range; the exact number is optional. */
function QuickPick({ spec, value, onChange }: { spec: FieldSpec; value: string; onChange: (v: string) => void }) {
  const active = bucketIndex(spec.buckets, value);
  const id = `pf-${spec.key}`;
  return (
    <fieldset className="pick span-all">
      <legend>{spec.label}{spec.hint && <span className="small muted"> · {spec.hint}</span>}</legend>
      <div className="chips" role="radiogroup" aria-label={spec.label}>
        {spec.buckets.map((b, i) => (
          <button
            type="button" key={b.label} role="radio" aria-checked={i === active}
            className={`pick-chip${i === active ? " on" : ""}`}
            onClick={() => onChange(i === active ? "" : String(b.value))}
          >{b.label}</button>
        ))}
        <input
          id={id} className="exact" type="number" inputMode="numeric" min={0} step={1} value={value}
          aria-label={`${spec.label}, exact number`} placeholder="or exact"
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </fieldset>
  );
}

export function ProfileForm({ school, initial, saving, onSave, onDelete }: Props) {
  const [d, setD] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [more, setMore] = useState(() => FIELDS.some((f) => !f.core && initial?.[f.key] != null));

  useEffect(() => setD(toDraft(initial)), [initial]);

  const scale = school.gpa_scale;
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setD({ ...d, [k]: e.target.value });
  const setVal = (k: string) => (v: string) => setD((prev) => ({ ...prev, [k]: v }));
  const { answered, total } = answeredCount(d);

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
      <p className="muted small span-all">Tap the closest range. Rough answers are fine, and every question is optional.</p>
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
        <input id="pf-gpa" type="number" inputMode="decimal" step="0.01" min={0} max={scale} value={d.gpa} onChange={set("gpa")}
          placeholder="Your best guess" />
      </div>

      {FIELDS.filter((f) => f.core).map((f) => <QuickPick key={f.key} spec={f} value={d[f.key]} onChange={setVal(f.key)} />)}

      {more
        ? FIELDS.filter((f) => !f.core).map((f) => <QuickPick key={f.key} spec={f} value={d[f.key]} onChange={setVal(f.key)} />)
        : (
          <button type="button" className="ghost span-all more" onClick={() => setMore(true)}>
            + Add hackathons, work and languages for a sharper picture
          </button>
        )}

      <div className="span-all meter" aria-live="polite">
        <div className="meter-bar" aria-hidden><span style={{ width: `${(answered / total) * 100}%` }} /></div>
        <span className="small muted">
          {answered} of {total} answered.{" "}
          {answered === total ? "Your picture is as sharp as it gets." : answered >= 4 ? "Enough for a first read; more makes it sharper." : "A few more answers make your results meaningful."}
        </span>
      </div>

      <p className="muted small span-all notice">
        Only share what you're comfortable with. Classmark is a free student project, and no site can
        promise its data will never leak. If this one did, your numbers could be matched to your school email.
      </p>
      <div className="actions span-all">
        <button type="submit" disabled={saving}>{saving ? "Saving…" : initial ? "Update my answers" : "See where I stand"}</button>
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
