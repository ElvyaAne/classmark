import { useState, type FormEvent } from "react";

interface Props {
  onRequest: (slug: string, name: string, scale: number, emailDomain: string, country: string) => Promise<"requested" | "exists">;
}

export function RequestSchool({ onRequest }: Props) {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [scale, setScale] = useState("4");
  const [country, setCountry] = useState("Canada");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slug = name.toLowerCase().replace(/\b(university|of|the|college)\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const cleanDomain = domain.trim().toLowerCase().replace(/^.*@/, "");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 3 || slug.length < 2) return setStatus("Enter the school's full name.");
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(cleanDomain)) return setStatus("Enter the part after the @ in student emails, like yorku.ca.");
    setBusy(true);
    try {
      const r = await onRequest(slug, name.trim(), Number(scale), cleanDomain, country.trim() || "Canada");
      setStatus(r === "exists" ? "That school is already listed or waiting for approval." : `Requested. ${name.trim()} will appear once it's approved.`);
      if (r === "requested") { setName(""); setDomain(""); }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="grid-form" onSubmit={submit}>
      <div className="field span-2">
        <label htmlFor="rs-name">School name</label>
        <input id="rs-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="York University" />
      </div>
      <div className="field">
        <label htmlFor="rs-domain">Student email domain</label>
        <input id="rs-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yorku.ca" autoCapitalize="off" spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor="rs-scale">GPA scale</label>
        <select id="rs-scale" value={scale} onChange={(e) => setScale(e.target.value)}>
          <option value="4">4.0</option>
          <option value="4.3">4.3</option>
          <option value="4.33">4.33</option>
          <option value="9">9-point</option>
          <option value="10">10-point</option>
          <option value="12">12-point</option>
          <option value="100">Percentage</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="rs-country">Country</label>
        <input id="rs-country" value={country} onChange={(e) => setCountry(e.target.value)} />
      </div>
      <div className="actions span-all">
        <button type="submit" className="ghost" disabled={busy}>Request school</button>
        {status && <span className="status" role="status">{status}</span>}
      </div>
    </form>
  );
}
