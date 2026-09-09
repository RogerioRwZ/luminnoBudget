import { Badge } from "@/components/ui/badge";
import {
  AsyncButton,
  FormError,
  getFormErrorMessage,
} from "@/components/FormFeedback";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  Database,
  HardDrive,
  KeyRound,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const bytes = (value?: number | null) => {
  if (value == null) return "Indisponível";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(amount)} ${units[index]}`;
};
const uptime = (seconds?: number) => {
  const total = Math.max(0, seconds ?? 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours ? `${hours}h ${minutes}min` : `${minutes}min`;
};

export default function AdminPage() {
  const utils = trpc.useUtils();
  const { data: status, isLoading: statusLoading, error: statusError, refetch: refetchStatus } =
    trpc.admin.systemStatus.useQuery();
  const { data: users = [], isLoading: usersLoading, error: usersError, refetch: refetchUsers } =
    trpc.admin.listUsers.useQuery();
  const [newUser, setNewUser] = useState({
    username: "",
    name: "",
    email: "",
    password: "",
    role: "user" as "user" | "admin",
  });
  const [adminError, setAdminError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const create = trpc.admin.createUser.useMutation({
    onSuccess: () => {
      utils.admin.listUsers.invalidate();
      utils.admin.systemStatus.invalidate();
      setAdminError("");
      setNewUser({
        username: "",
        name: "",
        email: "",
        password: "",
        role: "user",
      });
      toast.success("Usuário criado.");
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível criar o usuário. Confira nome, usuário e senha e tente novamente."
      );
      setAdminError(message);
      toast.error(message);
    },
  });
  const update = trpc.admin.updateUser.useMutation({
    onSuccess: () => {
      utils.admin.listUsers.invalidate();
      utils.admin.systemStatus.invalidate();
      setAdminError("");
      toast.success("Acesso atualizado.");
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível atualizar o acesso. Confira os dados e tente novamente."
      );
      setAdminError(message);
      toast.error(message);
    },
  });
  const reset = trpc.admin.resetPassword.useMutation({
    onSuccess: () => {
      setAdminError("");
      toast.success("Senha redefinida.");
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível redefinir a senha. Use pelo menos 12 caracteres e tente novamente."
      );
      setAdminError(message);
      toast.error(message);
    },
  });
  const refreshStatus = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        utils.admin.systemStatus.invalidate(),
        utils.admin.listUsers.invalidate(),
      ]);
      setAdminError("");
    } catch (error) {
      const message = getFormErrorMessage(
        error,
        "Não foi possível atualizar o status do sistema. Tente novamente."
      );
      setAdminError(message);
      toast.error(message);
    } finally {
      setRefreshing(false);
    }
  };
  const submitNewUser = () =>
    create.mutate({ ...newUser, email: newUser.email || undefined });

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow">Administração segura</p>
          <h2 className="page-title">Sistema e usuários</h2>
          <p className="page-description">
            Acompanhe a saúde da aplicação e gerencie os acessos locais.
          </p>
        </div>
        <AsyncButton
          variant="outline"
          pending={refreshing}
          loadingLabel="Atualizando…"
          onClick={refreshStatus}
        >
          Atualizar status
        </AsyncButton>
      </div>
      <FormError message={adminError} />
      {statusError || usersError ? (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-muted-foreground">
            Não foi possível carregar {statusError && usersError ? "o status do sistema e a lista de usuários" : statusError ? "o status do sistema" : "a lista de usuários"}.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (statusError) refetchStatus();
              if (usersError) refetchUsers();
            }}
          >
            Tentar novamente
          </Button>
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard
          icon={Activity}
          title="Aplicação"
          value={status?.application === "online" ? "Online" : "Verificando"}
          hint={`Ativa há ${uptime(status?.uptimeSeconds)}`}
          tone="text-emerald-600"
        />
        <StatusCard
          icon={Database}
          title="Banco de dados"
          value={status?.databaseOnline ? "Conectado" : "Indisponível"}
          hint={
            status?.databaseOnline
              ? "Consulta de saúde confirmada"
              : "Verifique a conexão"
          }
          tone={status?.databaseOnline ? "text-emerald-600" : "text-red-600"}
        />
        <StatusCard
          icon={UsersRound}
          title="Usuários locais"
          value={String(status?.localUserCount ?? 0)}
          hint="Acessos cadastrados"
          tone="text-primary"
        />
        <StatusCard
          icon={HardDrive}
          title="Uploads locais"
          value={
            status?.storage
              ? bytes(status.storage.availableBytes)
              : "Preparando"
          }
          hint={
            status?.storage
              ? `livres de ${bytes(status.storage.totalBytes)}`
              : "Diretório local"
          }
          tone="text-amber-600"
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <UserPlus className="h-5 w-5 text-primary" />
              Novo usuário
            </CardTitle>
            <CardDescription>
              Crie acessos locais. Administradores podem gerenciar usuários e
              configurações.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input
                value={newUser.name}
                onChange={event =>
                  setNewUser({ ...newUser, name: event.target.value })
                }
                placeholder="Nome da pessoa"
              />
            </div>
            <div className="space-y-2">
              <Label>Usuário</Label>
              <Input
                value={newUser.username}
                onChange={event =>
                  setNewUser({ ...newUser, username: event.target.value })
                }
                placeholder="ex.: comercial"
              />
            </div>
            <div className="space-y-2">
              <Label>
                E-mail <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                type="email"
                value={newUser.email}
                onChange={event =>
                  setNewUser({ ...newUser, email: event.target.value })
                }
                placeholder="email@empresa.com"
              />
            </div>
            <div className="space-y-2">
              <Label>Senha inicial</Label>
              <Input
                type="password"
                value={newUser.password}
                onChange={event =>
                  setNewUser({ ...newUser, password: event.target.value })
                }
                placeholder="Mínimo de 12 caracteres"
              />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select
                value={newUser.role}
                onValueChange={(role: "user" | "admin") =>
                  setNewUser({ ...newUser, role })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuário operacional</SelectItem>
                  <SelectItem value="admin">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <AsyncButton
              className="w-full"
              pending={create.isPending}
              loadingLabel="Criando usuário…"
              disabled={!newUser.name || !newUser.username || !newUser.password}
              onClick={submitNewUser}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Criar usuário
            </AsyncButton>
          </CardContent>
        </Card>
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-lg">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Acessos cadastrados
            </CardTitle>
            <CardDescription>
              {usersLoading
                ? "Carregando usuários…"
                : `${users.length} usuário(s) local(is) cadastrado(s).`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {users.map(user => (
              <UserAccessCard
                key={user.id}
                user={user}
                saving={update.isPending}
                onSave={changes => update.mutate(changes)}
                onReset={password => reset.mutate({ id: user.id, password })}
                resetting={reset.isPending}
              />
            ))}
            {!usersLoading && !users.length ? (
              <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nenhum usuário local encontrado.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
      <Card className="border-border/70 shadow-sm">
        <CardHeader>
          <CardTitle className="font-display text-lg">
            Informações operacionais
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <Info
            label="Versão do Node"
            value={
              statusLoading ? "Verificando…" : (status?.nodeVersion ?? "—")
            }
          />
          <Info
            label="Diretório de uploads"
            value={status?.uploadDirectory ?? "—"}
          />
          <Info
            label="Última leitura"
            value={
              status?.now ? new Date(status.now).toLocaleString("pt-BR") : "—"
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatusCard({
  icon: Icon,
  title,
  value,
  hint,
  tone,
}: {
  icon: typeof Activity;
  title: string;
  value: string;
  hint: string;
  tone: string;
}) {
  return (
    <Card className="border-border/70 shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              {title}
            </p>
            <p className={`mt-2 font-display text-xl font-black ${tone}`}>
              {value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
          <Icon className={`h-5 w-5 ${tone}`} />
        </div>
      </CardContent>
    </Card>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 break-all font-medium">{value}</p>
    </div>
  );
}
function UserAccessCard({
  user,
  saving,
  resetting,
  onSave,
  onReset,
}: {
  user: {
    id: number;
    username: string;
    name: string | null;
    email: string | null;
    role: "user" | "admin";
    isActive: boolean;
  };
  saving: boolean;
  resetting: boolean;
  onSave: (input: {
    id: number;
    name: string;
    email?: string;
    role: "user" | "admin";
    isActive: boolean;
  }) => void;
  onReset: (password: string) => void;
}) {
  const [name, setName] = useState(user.name ?? "");
  const [email, setEmail] = useState(user.email ?? "");
  const [role, setRole] = useState(user.role);
  const [isActive, setActive] = useState(user.isActive);
  const [newPassword, setNewPassword] = useState("");
  return (
    <div className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">{user.name || user.username}</p>
          <p className="font-mono text-xs text-muted-foreground">
            @{user.username}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={role === "admin" ? "default" : "secondary"}>
            {role === "admin" ? "Administrador" : "Operacional"}
          </Badge>
          <Badge variant={isActive ? "outline" : "destructive"}>
            {isActive ? "Ativo" : "Inativo"}
          </Badge>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Nome</Label>
          <Input value={name} onChange={event => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>E-mail</Label>
          <Input
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Papel</Label>
          <Select
            value={role}
            onValueChange={(value: "user" | "admin") => setRole(value)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">Usuário operacional</SelectItem>
              <SelectItem value="admin">Administrador</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end gap-3 pb-2">
          <Switch checked={isActive} onCheckedChange={setActive} />
          <Label>Conta ativa</Label>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2 border-t pt-3 sm:flex-row">
        <AsyncButton
          size="sm"
          pending={saving}
          loadingLabel="Salvando…"
          disabled={!name}
          onClick={() =>
            onSave({
              id: user.id,
              name,
              email: email || undefined,
              role,
              isActive,
            })
          }
        >
          Salvar acesso
        </AsyncButton>
        <div className="flex flex-1 gap-2">
          <Input
            type="password"
            value={newPassword}
            onChange={event => setNewPassword(event.target.value)}
            placeholder="Nova senha (mín. 12)"
          />
          <AsyncButton
            size="sm"
            variant="outline"
            pending={resetting}
            loadingLabel="Redefinindo…"
            disabled={newPassword.length < 12}
            onClick={() => {
              onReset(newPassword);
              setNewPassword("");
            }}
          >
            <KeyRound className="mr-1 h-3.5 w-3.5" />
            Redefinir
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}
