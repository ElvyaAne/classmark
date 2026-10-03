// Thin client for Supabase Auth (anonymous sign-in) and PostgREST RPC calls.
// No SDK needed: the app only uses six database functions.

export interface School {
  slug: string;
  name: string;
  country: string;
  gpa_scale: number;
  responses: number;
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
  metrics: Partial<Record<MetricKey, number[] | null>> | null;
}

interface Session {
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
    return raw ? (JSON.parse(raw) as Session) : null;
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
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = data?.message || data?.msg || data?.error_description || `Request failed (${res.status})`;
      throw new ApiError(msg, res.status, data?.code);
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

  /** Returns a valid access token, refreshing it, or signing in anonymously when `create` is true. */
  async function token(create: boolean): Promise<string | null> {
    const now = Math.floor(Date.now() / 1000);
    if (session && session.expires_at - 60 > now) return session.access_token;
    if (session) {
      try {
        session = toSession(await request("/auth/v1/token?grant_type=refresh_token", { refresh_token: session.refresh_token }));
        writeSession(session);
        return session.access_token;
      } catch {
        session = null;
        writeSession(null);
      }
    }
    if (!create) return null;
    session = toSession(await request("/auth/v1/signup", { data: {} }));
    writeSession(session);
    return session.access_token;
  }

  const rpc = async <T>(fn: string, args: object, auth: "none" | "if-signed-in" | "required" = "none") => {
    const t = auth === "none" ? undefined : (await token(auth === "required")) ?? undefined;
    return request<T>(`/rest/v1/rpc/${fn}`, args, t);
  };

  return {
    hasSession: () => session !== null,
    listSchools: () => rpc<School[]>("list_schools", {}),
    peerStats: (school: string | null, program: string | null, year: number | null) =>
      rpc<PeerStats>("peer_stats", { p_school: school, p_program: program, p_year: year }, "if-signed-in"),
    getMyResponse: async () => (session ? rpc<SavedResponse | null>("get_my_response", {}, "if-signed-in") : null),
    saveMyResponse: (r: ResponseInput) => rpc<SavedResponse>("save_my_response", { p: r }, "required"),
    deleteMyResponse: () => rpc<null>("delete_my_response", {}, "required"),
    requestSchool: (slug: string, name: string, gpaScale: number, country: string) =>
      rpc<"requested" | "exists">("request_school", { p_slug: slug, p_name: name, p_gpa_scale: gpaScale, p_country: country }, "required"),
  };
}
export type Api = ReturnType<typeof createApi>;
