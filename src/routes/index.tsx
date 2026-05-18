import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { verifyPassword } from "@/lib/pedalcast.functions";
import { loadSession, saveSession } from "@/lib/usePedalSession";
import { Bike, KeyRound, Radio } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Pedalcast — Live cycling broadcaster with GPS" },
      {
        name: "description",
        content:
          "Pedalcast streams your bike ride live — camera, mic and real-time GPS — to anyone with the viewer pass.",
      },
      { property: "og:title", content: "Pedalcast — Live cycling broadcaster" },
      {
        property: "og:description",
        content: "Stream your ride live with camera, mic and GPS tracking.",
      },
    ],
  }),
});

function Landing() {
  const navigate = useNavigate();
  const verify = useServerFn(verifyPassword);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSession();
    if (s?.role === "admin") navigate({ to: "/admin" });
    else if (s?.role === "user") navigate({ to: "/live" });
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await verify({ data: { password } });
      saveSession({ role: res.role, password });
      navigate({ to: res.role === "admin" ? "/admin" : "/live" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
      <header className="flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Bike className="h-5 w-5" />
          </span>
          <span className="display text-2xl">PEDALCAST</span>
        </Link>
        <span className="rounded-full border border-border px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
          v1 · live ride broadcaster
        </span>
      </header>

      <section className="mt-20 grid items-center gap-12 md:mt-28 md:grid-cols-2">
        <div>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs uppercase tracking-widest text-primary">
            <Radio className="h-3.5 w-3.5" /> Live · Camera · Mic · GPS
          </p>
          <h1 className="display text-5xl leading-[0.95] text-balance md:text-7xl">
            Every kilometre,
            <br />
            <span className="text-primary">broadcast in real time.</span>
          </h1>
          <p className="mt-6 max-w-md text-muted-foreground">
            Pedalcast turns any ride into a live transmission — your camera and
            voice streamed peer-to-peer, your route tracked on the map, second
            by second. The admin rides. Everyone else watches.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-border bg-card/80 p-7 backdrop-blur"
        >
          <div className="mb-5 flex items-center gap-2 text-sm text-muted-foreground">
            <KeyRound className="h-4 w-4" /> Enter access pass
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoFocus
            className="w-full rounded-lg border border-border bg-background px-4 py-3 font-mono text-lg tracking-widest outline-none focus:border-primary"
          />
          {error && (
            <p className="mt-3 text-sm text-destructive">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading || !password}
            className="mt-5 w-full rounded-lg bg-primary px-4 py-3 font-semibold text-primary-foreground transition hover:brightness-110 disabled:opacity-50"
          >
            {loading ? "Verifying…" : "Enter"}
          </button>
          <p className="mt-4 text-xs text-muted-foreground">
            One pass for admin (rider), one pass for viewers. Admin can rotate
            both from the control panel.
          </p>
        </form>
      </section>

      <footer className="mt-auto pt-16 text-xs text-muted-foreground">
        © Pedalcast — built for riders who want their journey seen.
      </footer>
    </main>
  );
}
