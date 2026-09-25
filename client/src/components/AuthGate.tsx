import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginInput } from "@shared/auth-schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { LockKeyhole, LogOut } from "lucide-react";

type Session = { expiresAt: number };
const AuthContext = createContext({ logout: async () => {}, busy: false });
export function LogoutButton() {
  const auth = useContext(AuthContext);
  return <Button variant="outline" size="sm" disabled={auth.busy} onClick={auth.logout} data-testid="button-logout">
    <LogOut className="h-4 w-4 mr-1.5" /> Sair
  </Button>;
}
export function LegacyEntry() {
  const target = "https://painel-andamentos-backend.vercel.app/" + (location.hash || "#/");
  useEffect(() => {
    if (location.hostname === "andamentos-cf.pplx.app") location.replace(target);
  }, [target]);
  return <main className="min-h-screen grid place-items-center p-6 bg-background text-foreground">
    <div className="max-w-md space-y-5 text-center">
      <div className="flex justify-center text-primary"><Logo /></div>
      <h1 className="text-xl font-semibold">Painel de Andamentos</h1>
      <p className="text-muted-foreground">O painel agora tem acesso protegido. Seus processos continuam no aplicativo.</p>
      <Button asChild><a href={target} target="_blank" rel="noopener noreferrer">Abrir painel com login</a></Button>
      <p className="text-sm text-muted-foreground">Entre com sua conta administradora do Google.</p>
    </div>
  </main>;
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const form = useForm({ resolver: zodResolver(loginInput), defaultValues: { email: "", password: "" } });
  const clear = useCallback(() => {
    epoch.current++;
    setSession(null);
    void queryClient.cancelQueries();
    queryClient.clear();
  }, []);
  const check = useCallback(async () => {
    const generation = epoch.current;
    try {
      const res = await apiRequest("GET", "/api/auth/session");
      const data = await res.json();
      if (generation !== epoch.current) return;
      if (data.authenticated) setSession({ expiresAt: data.expiresAt });
      else clear();
    } catch {
      if (generation === epoch.current) { clear(); setError("Não foi possível conferir sua sessão. Tente novamente."); }
    } finally { setLoading(false); }
  }, [clear]);
  useEffect(() => {
    const result = new URLSearchParams(location.search).get("login");
    if (result === "failed") setError("Login cancelado, expirado ou conta não autorizada. Use a conta administradora.");
    if (location.search) history.replaceState(null, "", location.pathname + (location.hash || "#/"));
    void check();
    const expired = () => { clear(); setError("Sua sessão terminou. Entre novamente."); setLoading(false); };
    window.addEventListener("auth-expired", expired);
    window.addEventListener("focus", check);
    return () => { window.removeEventListener("auth-expired", expired); window.removeEventListener("focus", check); };
  }, [check, clear]);
  useEffect(() => {
    if (!session) return;
    const interval = window.setInterval(check, 60_000);
    const timer = window.setTimeout(() => { clear(); setError("Sua sessão terminou. Entre novamente."); }, Math.max(0, session.expiresAt - Date.now()));
    return () => { clearInterval(interval); clearTimeout(timer); };
  }, [session, check, clear]);
  async function passwordLogin(value: { email: string; password: string }) {
    setBusy(true); setError("");
    try {
      const result = await (await apiRequest("POST", "/api/auth/password", value)).json();
      clear(); setSession({ expiresAt: result.expiresAt }); form.reset();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); form.setValue("password", ""); }
  }
  async function googleLogin() {
    setBusy(true); setError("");
    try {
      const { url } = await (await apiRequest("POST", "/api/auth/google", {})).json();
      location.assign(url);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try { await apiRequest("POST", "/api/auth/logout", {}); clear(); setError(""); }
    catch { setError("Não foi possível sair. Tente novamente antes de deixar o dispositivo."); }
    finally { setBusy(false); }
  }
  if (loading) return <main className="min-h-screen grid place-items-center text-muted-foreground" role="status">Conferindo acesso…</main>;
  if (session) return <AuthContext.Provider value={{ logout, busy }}>
    {error && <div role="alert" className="bg-destructive text-destructive-foreground p-3 text-center">{error}</div>}
    {children}
  </AuthContext.Provider>;
  return <main className="min-h-screen grid place-items-center bg-background text-foreground p-5">
    <section className="w-full max-w-md rounded-xl border bg-card p-7 shadow-sm space-y-6">
      <div className="flex gap-3 items-center text-primary"><Logo /><h1 className="text-xl font-semibold">Painel de Andamentos</h1></div>
      <div><h2 className="text-lg font-semibold flex gap-2 items-center"><LockKeyhole className="h-5 w-5" /> Acesso restrito</h2>
        <p className="text-sm text-muted-foreground mt-2">Entre com sua conta administradora. Não há cadastro público.</p></div>
      <Button className="w-full" disabled={busy} onClick={googleLogin} data-testid="button-google">Entrar com Google</Button>
      <div className="text-center text-sm text-muted-foreground">ou use sua senha do aplicativo</div>
      <Form {...form}><form onSubmit={form.handleSubmit(passwordLogin)} className="space-y-4">
        <FormField control={form.control} name="email" render={({ field }) => <FormItem><FormLabel>E-mail</FormLabel><FormControl><Input {...field} type="email" autoComplete="username" data-testid="input-email" /></FormControl><FormMessage /></FormItem>} />
        <FormField control={form.control} name="password" render={({ field }) => <FormItem><FormLabel>Senha do aplicativo</FormLabel><FormControl><Input {...field} type="password" autoComplete="current-password" data-testid="input-password" /></FormControl><FormMessage /></FormItem>} />
        <Button className="w-full" variant="outline" type="submit" disabled={busy} data-testid="button-login">{busy ? "Aguarde…" : "Entrar com senha"}</Button>
      </form></Form>
      {error && <p className="text-sm text-destructive" role="alert" data-testid="text-error">{error}</p>}
      <p className="text-xs text-muted-foreground leading-relaxed">Se você usa o Google, não precisa preencher os campos de senha. Sessão de até 30 minutos; utilize Sair ao terminar.</p>
    </section>
  </main>;
}
