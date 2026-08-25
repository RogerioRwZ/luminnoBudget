import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { validateLoginCredentials } from "@shared/formValidation";
import { KeyRound, LockKeyhole, UserPlus, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function AuthPage({ setupRequired }: { setupRequired: boolean }) {
  const utils = trpc.useUtils();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const complete = () => {
    utils.auth.status.invalidate();
    utils.auth.me.invalidate();
  };
  const setup = trpc.auth.setup.useMutation({ onSuccess: () => { complete(); toast.success("Administrador criado com segurança."); }, onError: (error) => toast.error(error.message) });
  const login = trpc.auth.login.useMutation({ onSuccess: () => { complete(); toast.success("Acesso liberado."); }, onError: (error) => toast.error(error.message) });
  const pending = setup.isPending || login.isPending;
  const submit = () => {
    const validation = validateLoginCredentials({ username, password, setupRequired, name, email });
    if (validation) { toast.error(validation); return; }
    if (setupRequired) setup.mutate({ username: username.trim().toLowerCase(), password, name: name.trim(), email: email.trim() || undefined });
    else login.mutate({ username: username.trim().toLowerCase(), password });
  };

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#151515] px-4 py-10 text-white">
      <div className="absolute inset-0 opacity-50 [background:radial-gradient(circle_at_top_right,#f4d84222,transparent_28%),radial-gradient(circle_at_bottom_left,#ffffff10,transparent_30%)]" />
      <Card className="relative w-full max-w-md border-white/10 bg-white text-foreground shadow-2xl">
        <CardHeader className="space-y-4 pb-4">
          <div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-xl bg-[#f4d842] text-xs font-black text-black">LUM</div><div><p className="font-display text-lg font-black tracking-tight">Luminno</p><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">Orçamentos</p></div></div>
          <div><p className="eyebrow">Acesso seguro</p><CardTitle className="mt-1 font-display text-2xl">{setupRequired ? "Criar administrador" : "Entrar no sistema"}</CardTitle><CardDescription className="mt-2 leading-relaxed">{setupRequired ? "Defina o primeiro acesso administrativo. Esta etapa só pode ser realizada uma vez." : "Use suas credenciais locais para acessar a gestão da Luminno."}</CardDescription></div>
        </CardHeader>
        <CardContent className="space-y-4">
          {setupRequired ? <div className="space-y-2"><Label htmlFor="name">Nome completo</Label><Input id="name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Responsável pela gestão" /></div> : null}
          <div className="space-y-2"><Label htmlFor="username">Usuário</Label><div className="relative"><UserRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="username" className="pl-9" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="ex.: ana.silva" /></div><p className="text-xs text-muted-foreground">Use letras minúsculas, números, ponto, hífen ou sublinhado.</p></div>
          {setupRequired ? <div className="space-y-2"><Label htmlFor="email">E-mail <span className="text-muted-foreground">(opcional)</span></Label><Input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="contato@empresa.com" /></div> : null}
          <div className="space-y-2"><Label htmlFor="password">Senha</Label><div className="relative"><LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input id="password" type="password" className="pl-9" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={setupRequired ? "new-password" : "current-password"} placeholder="Mínimo de 12 caracteres" onKeyDown={(event) => { if (event.key === "Enter") submit(); }} /></div></div>
          <Button className="h-11 w-full" disabled={pending || !username || !password || (setupRequired && !name)} onClick={submit}>{setupRequired ? <UserPlus className="mr-2 h-4 w-4" /> : <KeyRound className="mr-2 h-4 w-4" />}{pending ? "Validando…" : setupRequired ? "Criar acesso administrativo" : "Entrar"}</Button>
          <p className="rounded-lg bg-muted px-3 py-2 text-center text-xs leading-relaxed text-muted-foreground">As senhas são protegidas no servidor e a sessão é armazenada em cookie seguro.</p>
        </CardContent>
      </Card>
    </main>
  );
}
