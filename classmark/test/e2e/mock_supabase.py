"""Local stand-in for the Supabase endpoints Classmark uses, for end-to-end tests only.

Implements email one-time-code sign-in (/otp + /verify), token refresh, logout and
PostgREST-style RPC calls on top of a real PostgreSQL database loaded with supabase/migrations
+ seed. Sign-ups go through the real auth.users trigger, so non-school emails fail the same way.
For tests, GET /__test/otp?email=... returns the last code (and user id) sent to an address. Every RPC runs under the same
roles Supabase uses (anon / authenticated) with request.jwt.claims set, so grants and
auth.uid() behave as in production. Also serves the built app from --static.
"""
import argparse, json, os, random, re, shlex, subprocess, uuid
from urllib.parse import parse_qs, urlparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ap = argparse.ArgumentParser()
ap.add_argument("--port", type=int, default=8787)
ap.add_argument("--static", required=True)
ap.add_argument("--psql", required=True, help='psql connection args, e.g. "-h localhost -U postgres -d db"')
args = ap.parse_args()

def psql(sql: str) -> tuple[bool, str]:
    p = subprocess.run(["psql", *shlex.split(args.psql), "-qAt", "-v", "ON_ERROR_STOP=1", "-c", sql],
                       capture_output=True, text=True)
    return p.returncode == 0, (p.stdout if p.returncode == 0 else p.stderr)

# function signatures: name -> (returns_set, [(arg, type)])
ok, out = psql("""select json_object_agg(p.proname, json_build_object('set', p.proretset,
  'args', coalesce((select json_agg(json_build_array(n, format_type(t, null)) order by o)
   from unnest(p.proargnames, p.proargtypes::oid[]) with ordinality u(n, t, o)), '[]')))
  from pg_proc p join pg_namespace s on s.oid = p.pronamespace
  where s.nspname = 'public' and p.proname not like '\\_%'""")
assert ok, out
SIGS = json.loads(out.strip())

def tag() -> str:
    return "q" + uuid.uuid4().hex[:8]

def lit(v: str) -> str:
    t = tag()
    return f"${t}${v}${t}$"

CODES: dict[str, tuple[str, str]] = {}  # email -> (code, user id)

def call(fn: str, body: dict, sub: str | None):
    sig = SIGS.get(fn)
    if not sig:
        return 404, {"message": f"Could not find the function public.{fn}", "code": "PGRST202"}
    parts = []
    for name, typ in sig["args"]:
        if name in body:
            expr = f"(b->'{name}')" if typ == "jsonb" else f"(b->>'{name}')::{typ}"
            parts.append(f"{name} => {expr}")
    invocation = f"public.{fn}({', '.join(parts)})"
    t = tag()
    src = f"(select ${t}${json.dumps(body)}${t}$::jsonb b) x"
    # always print exactly one line of JSON text ("null" for SQL null), so the result can't be
    # confused with the set_config line printed before it
    select = (f"select coalesce(jsonb_agg(r), '[]'::jsonb)::text from {src}, lateral {invocation} r" if sig["set"]
              else f"select coalesce(to_jsonb({invocation})::text, 'null') from {src}")
    role = "authenticated" if sub else "anon"
    claims = json.dumps({"sub": sub, "role": role} if sub else {"role": "anon"})
    ok, out = psql(f"begin; set local role {role}; "
                   f"select set_config('request.jwt.claims', ${t}${claims}${t}$, true); {select}; commit;")
    if not ok:
        m = re.search(r"ERROR:\s+(.*)", out)
        msg = m.group(1).strip() if m else out.strip()
        status = 401 if "permission denied" in msg or "Sign-in required" in msg else 400
        return status, {"message": msg, "code": "P0001"}
    lines = [l for l in out.strip().splitlines()]
    value = lines[-1] if lines else "null"
    return 200, json.loads(value) if value else None

# Same security headers the real host sends (public/_headers), so the test catches CSP breakage.
HEADERS = [tuple(l.strip().split(": ", 1)) for l in open("public/_headers")
           if l.startswith("  ") and ": " in l and not l.strip().startswith("Strict-Transport")]

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=args.static, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        if self.command == "GET":
            for k, v in HEADERS:
                self.send_header(k, v)
        super().end_headers()

    def send_json(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/__test/otp":
            email = parse_qs(urlparse(self.path).query).get("email", [""])[0].lower()
            code, uid = CODES.get(email, ("", ""))
            return self.send_json(200, {"code": code, "user_id": uid})
        if path == "/__test/confirm":  # stands in for clicking the link in the email
            email = parse_qs(urlparse(self.path).query).get("email", [""])[0].lower()
            code, uid = CODES.pop(email, ("", ""))
            ok, out = psql(f"update auth.users set email_confirmed_at = now() where id = '{uid}'") if uid else (False, "")
            return self.send_json(200 if ok else 404, {"user_id": uid})
        if path == "/__test/user":  # whether an account still exists for an address
            email = parse_qs(urlparse(self.path).query).get("email", [""])[0]
            ok, out = psql(f"select count(*) from auth.users where lower(email) = lower({lit(email)})")
            return self.send_json(200, {"exists": ok and out.strip() != "0"})
        if path == "/__test/backdate":  # moves a student's saved history into the past
            q = parse_qs(urlparse(self.path).query)
            email, days = q.get("email", [""])[0], int(q.get("days", ["0"])[0])
            ok, out = psql(f"update public.response_history h set day = day - {days} from auth.users u "
                           f"where u.id = h.user_id and lower(u.email) = lower({lit(email)})")
            return self.send_json(200 if ok else 500, {})
        if not os.path.exists(os.path.join(args.static, path.lstrip("/"))) or path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        auth = (self.headers.get("Authorization") or "").removeprefix("Bearer ")
        if self.path.startswith("/auth/v1/otp"):
            email = str(body.get("email", "")).strip()
            ok, out = psql(f"select id from auth.users where lower(email) = lower({lit(email)})")
            uid = out.strip() if ok else ""
            if not uid:
                uid = str(uuid.uuid4())
                ok, out = psql(f"insert into auth.users (id, email) values ('{uid}', {lit(email)})")
                if not ok:  # what GoTrue returns when a trigger on auth.users refuses the row
                    return self.send_json(500, {"code": 500, "error_code": "unexpected_failure",
                                                "msg": "Database error saving new user"})
            CODES[email.lower()] = (f"{random.randint(0, 999999):06d}", uid)
            return self.send_json(200, {})
        if self.path.startswith("/auth/v1/verify"):
            email = str(body.get("email", "")).strip().lower()
            code, uid = CODES.get(email, ("", ""))
            if not code or body.get("token") != code or body.get("type") != "email":
                return self.send_json(403, {"code": 403, "error_code": "otp_expired",
                                            "msg": "Token has expired or is invalid"})
            del CODES[email]
            ok, out = psql(f"update auth.users set email_confirmed_at = now() where id = '{uid}'")
            assert ok, out
            return self.send_json(200, {"access_token": "u:" + uid, "refresh_token": "r:" + uid,
                                        "expires_in": 3600, "user": {"id": uid, "email": email}})
        if self.path.startswith("/auth/v1/logout"):
            self.send_response(204)
            self.end_headers()
            return
        if self.path.startswith("/auth/v1/token"):
            uid = str(body.get("refresh_token", "")).removeprefix("r:")
            return self.send_json(200, {"access_token": "u:" + uid, "refresh_token": "r:" + uid, "expires_in": 3600})
        if self.path.startswith("/rest/v1/rpc/"):
            sub = auth[2:] if auth.startswith("u:") else None
            status, payload = call(self.path.split("/")[-1].split("?")[0], body, sub)
            return self.send_json(status, payload)
        self.send_json(404, {"message": "not found"})

print(f"mock supabase on :{args.port}", flush=True)
ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
