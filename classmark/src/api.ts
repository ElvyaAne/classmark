// Thin client for Supabase Auth (email one-time codes) and PostgREST RPC calls.
// No SDK needed: the app only uses a handful of database functions.

export interface School {
  slug: string;
  name: string;
  country: string;
  gpa_scale: number;
  responses: number;
  email_domains: string[];
}

export const PROGRAMS = [
  "Computer Science",
  "CS & Mathematics",
  "Mathematics",
  "Software Engineering",
  "Computer Engineering",
  "Electrical Engineering",
  "Data Science",
  "Statistics",
  "Other",
] as const;
export type Program = (typeof PROGRAMS)[number];

export interface ResponseInput {
  school_slug: string;
  program: Program;
  year: number;
  gpa: number | null;
  projects: number | null;
  hackathons: number | null;
  hackathon_wins: number | null;
  leetcode: number | null;
  internships: number | null;
  work_months: number | null;
  languages: number | null;
}
export interface SavedResponse extends ResponseInput {
  created_at: string;
  updated_at: string;
}

export type MetricKey =
  | "gpa_pct" | "projects" | "hackathons" | "hackathon_wins"
  | "leetcode" | "internships" | "work_months" | "languages";

export interface PeerStats {
  n: number;
  min_n: number;
  /** true when the group is big enough but hidden because a wider group differs by under 5 people */
  suppressed?: boolean;
  metrics: Partial<Record<MetricKey, number[]>> | null;
}

export interface AverageStudent {
  n: number;
  min_n: number;
  suppressed?: boolean;
  averages: Partial<Record<MetricKey, number>> | null;
}

export interface Me {
  email: string;
  verified: boolean;
  school_slug: string | null;
}

export interface Session {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

const SESSION_KEY = "classmark.session";

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? (JSON.parse(raw) as Session) : null;
    return s && typeof s.access_token === "string" && typeof s.refresh_token === "string" ? s : null;
  } catch {
    return null;
  }
}
function writeSession(s: Session | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: session lasts for this tab only */
  }
}

/** Lower-cased domain of an email address, or null if it doesn't look like one. */
export function emailDomain(email: string): string | null {
  const m = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/.exec(email.trim());
  return m ? m[1].toLowerCase() : null;
}

/** The listed school an email belongs to (same rule as the database: exact domain or a subdomain). */
export function schoolForEmail(email: string, schools: School[]): School | null {
  const host = emailDomain(email);
  if (!host) return null;
  return schools.find((s) => s.email_domains.some((d) => host === d || host.endsWith("." + d))) ?? null;
}

/**
 * Reads a session from a magic-link redirect (#access_token=…&refresh_token=…) if the
 * person clicked the link in the email instead of typing the code. Returns an error message
 * when the link was expired or already used.
 */
export function sessionFromUrlHash(hash: string): { session?: Session; error?: string } | null {
  if (!hash || hash.length < 2) return null;
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  if (p.get("error") || p.get("error_description")) {
    return { error: p.get("error_description")?.replace(/\+/g, " ") || "That sign-in link didn't work. Request a new code." };
  }
  const access = p.get("access_token");
  const refresh = p.get("refresh_token");
  if (!access || !refresh) return null;
  const expiresAt = Number(p.get("expires_at")) || Math.floor(Date.now() / 1000) + (Number(p.get("expires_in")) || 3600);
  return { session: { access_token: access, refresh_token: refresh, expires_at: expiresAt } };
}

function friendly(msg: string, status: number): string {
  if (/database error saving new user/i.test(msg)) return "Use your school email address. Only listed schools can sign in.";
  if (/token has expired or is invalid|otp.*(expired|invalid)/i.test(msg)) return "That code is wrong or expired. Check the latest email, or send a new code.";
  if (status === 429 || /rate limit|security purposes/i.test(msg)) return "Too many tries. Wait a minute, then try again.";
  if (/captcha/i.test(msg)) return "The robot check didn't go through. Try again.";
  return msg;
}

export function createApi(url: string, anonKey: string, fetchImpl: typeof fetch = fetch.bind(globalThis)) {
  let session: Session | null = readSession();
  const base = url.replace(/\/+$/, "");

  async function request<T>(path: string, body: unknown, token?: string): Promise<T> {
    const res = await fetchImpl(base + path, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${token ?? anonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const msg = data?.message || data?.msg || data?.error_description || `Request failed (${res.status})`;
      throw new ApiError(friendly(String(msg), res.status), res.status, data?.code ?? data?.error_code);
    }
    return data as T;
  }

  function toSession(d: { access_token: string; refresh_token: string; expires_in?: number; expires_at?: number }): Session {
    return {
      access_token: d.access_token,
      refresh_token: d.refresh_token,
      expires_at: d.expires_at ?? Math.floor(Date.now() / 1000) + (d.expires_in ?? 3600),
    };
  }

  function setSession(s: Session | null) {
    session = s;
    writeSession(s);
  }

  /** A valid access token (refreshed if needed), or null when signed out. */
  async function token(): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);
    if (session && session.expires_at - 60 > now) return session.access_token;
    if (session) {
      try {
        setSession(toSession(await request("/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh_token })));
        return session!.access_token;
      } catch {
        setSession(null);
      }
    }
    return null;
  }

  const rpc = async <T>(fn: string, args: object, auth: "none" | "if-signed-in" | "required" = "none") => {
    const t = auth === "none" ? null : await token();
    if (auth === "required" && !t) throw new ApiError("Sign in with your school email first.", 401);
    return request<T>(`/rest/v1/rpc/${fn}`, args, t ?? undefined);
  };

  return {
    isSignedIn: () => session !== null,

    /** Emails a one-time code (and a sign-in link) to a school address. */
    sendCode: (email: string, captchaToken?: string) =>
      request<unknown>("/auth/v1/otp", {
        email: email.trim(),
        create_user: true,
        ...(captchaToken ? { gotrue_meta_security: { captcha_token: captchaToken } } : {}),
      }).then(() => undefined),

    /** Exchanges the emailed code for a session. */
    verifyCode: async (email: string, code: string) => {
      const d = await request<{ access_token: string; refresh_token: string; expires_in?: number; expires_at?: number }>(
        "/auth/v1/verify", { type: "email", email: email.trim(), token: code.replace(/\s+/g, "") });
      setSession(toSession(d));
    },

    /** Adopts a session from a magic-link redirect. */
    adoptSession: (s: Session) => setSession(s),

    signOut: async () => {
      const t = session?.access_token;
      setSession(null);
      if (t) await request("/auth/v1/logout", {}, t).catch(() => undefined);
    },

    listSchools: () => rpc<School[]>("list_schools", {}),
    averageStudent: (school: string | null, program: string | null, year: number | null) =>
      rpc<AverageStudent>("average_student", { p_school: school, p_program: program, p_year: year }),
    whoami: async () => ((await token()) ? rpc<Me | null>("whoami", {}, "required") : null),
    peerStats: (school: string | null, program: string | null, year: number | null) =>
      rpc<PeerStats>("peer_stats", { p_school: school, p_program: program, p_year: year }, "required"),
    getMyResponse: () => rpc<SavedResponse | null>("get_my_response", {}, "required"),
    saveMyResponse: (r: ResponseInput) => rpc<SavedResponse>("save_my_response", { p: r }, "required"),
    deleteMyResponse: () => rpc<null>("delete_my_response", {}, "required"),
    deleteMyAccount: async () => {
      await rpc<null>("delete_my_account", {}, "required");
      setSession(null);
    },
    requestSchool: (slug: string, name: string, gpaScale: number, emailDomain: string, country: string) =>
      rpc<"requested" | "exists">("request_school",
        { p_slug: slug, p_name: name, p_gpa_scale: gpaScale, p_email_domain: emailDomain, p_country: country }, "if-signed-in"),
  };
}
export type Api = ReturnType<typeof createApi>;
