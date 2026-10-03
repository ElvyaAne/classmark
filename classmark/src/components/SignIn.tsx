import { useEffect, useRef, useState, type FormEvent } from "react";
import { schoolForEmail, type Api, type School } from "../api";

interface Props {
  api: Api;
  schools: School[];
  /** Cloudflare Turnstile site key. When set, a robot check runs before a code is sent. */
  captchaKey?: string;
  onSignedIn: () => void;
}

const RESEND_SECONDS = 60;

export function SignIn({ api, schools, captchaKey, onSignedIn }: Props) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRun, setCaptchaRun] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(wait - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const school = schoolForEmail(email, schools);
  const examples = schools.slice(0, 3).map((s) => s.email_domains[0]).filter(Boolean);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!school) {
      return setError(`Use your school email (like name@${examples[0] ?? "uottawa.ca"}). If your school isn't listed, request it below.`);
    }
    if (captchaKey && !captcha) return setError("Finish the robot check first.");
    setBusy(true);
    setError(null);
    try {
      await api.sendCode(email, captcha ?? undefined);
      setStep("code");
      setCode("");
      setWait(RESEND_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the code. Try again.");
    } finally {
      setBusy(false);
      // a Turnstile token works once; get a fresh one for the next send
      if (captchaKey) { setCaptcha(null); setCaptchaRun((n) => n + 1); }
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (code.replace(/\s+/g, "").length < 6) return setError("Enter the code from the email.");
    setBusy(true);
    setError(null);
    try {
      await api.verifyCode(email, code);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "code") {
    return (
      <form className="signin stack tight" onSubmit={verify}>
        <p className="small">We emailed a code to <b>{email.trim()}</b>. It can take a minute, and may land in junk mail.</p>
        <div className="signin-row">
          <div className="field">
            <label htmlFor="si-code">Code from the email</label>
            <input id="si-code" className="code" value={code} onChange={(e) => setCode(e.target.value)}
              inputMode="numeric" autoComplete="one-time-code" maxLength={12} autoFocus />
          </div>
          <button type="submit" disabled={busy}>{busy ? "Checking…" : "Verify"}</button>
        </div>
        <div className="actions small">
          <button type="button" className="link" onClick={() => { setStep("email"); setError(null); }}>Use a different email</button>
          <button type="button" className="link" disabled={wait > 0 || busy} onClick={() => send()}>
            {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
          </button>
        </div>
        {captchaKey && <Turnstile siteKey={captchaKey} run={captchaRun} onToken={setCaptcha} />}
        {error && <p className="status error" role="alert">{error}</p>}
      </form>
    );
  }

  return (
    <form className="signin stack tight" onSubmit={send}>
      <div className="signin-row">
        <div className="field">
          <label htmlFor="si-email">School email</label>
          <input id="si-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder={`you@${examples[0] ?? "uottawa.ca"}`} autoComplete="email" autoCapitalize="off" spellCheck={false} />
        </div>
        <button type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
      </div>
      <p className="small muted" aria-live="polite">
        {school ? `You'll be compared within ${school.name}.` : "No password. We email you a one-time code to confirm you're a student."}
      </p>
      {captchaKey && <Turnstile siteKey={captchaKey} run={captchaRun} onToken={setCaptcha} />}
      {error && <p className="status error" role="alert">{error}</p>}
    </form>
  );
}

// ---------------------------------------------------------------- Cloudflare Turnstile (optional)

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      remove: (id: string) => void;
    };
  }
}

let scriptPromise: Promise<void> | null = null;
function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { scriptPromise = null; reject(new Error("Couldn't load the robot check.")); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function Turnstile({ siteKey, run, onToken }: { siteKey: string; run: number; onToken: (t: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | null = null;
    let gone = false;
    loadTurnstile().then(() => {
      if (gone || !ref.current || !window.turnstile) return;
      id = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        callback: (t: string) => onToken(t),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    }).catch(() => onToken(null));
    return () => { gone = true; if (id && window.turnstile) window.turnstile.remove(id); };
  }, [siteKey, run, onToken]);
  return <div ref={ref} className="captcha" />;
}
