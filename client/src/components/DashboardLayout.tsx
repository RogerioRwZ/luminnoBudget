import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import {
  ArchiveRestore,
  BarChart3,
  HandCoins,
  CalendarDays,
  ShoppingCart,
  FileText,
  Files,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Moon,
  PackageSearch,
  Warehouse,
  ScanLine,
  Settings,
  ShieldCheck,
  Sun,
  UsersRound,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { DailySummaryButton } from "./DailySummary";
import { useLocation } from "wouter";
import { canOpenPage, ROLE_LABELS, type UserRole } from "@shared/permissions";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import { useEffect } from "react";

const menuItems = [
  { icon: LayoutDashboard, label: "Visão geral", path: "/" },
  { icon: FileText, label: "Orçamentos", path: "/orcamentos" },
  { icon: CalendarDays, label: "Agenda", path: "/agenda" },
  { icon: Files, label: "Histórico de PDFs", path: "/historico-pdfs" },
  { icon: Landmark, label: "Financeiro", path: "/financeiro" },
  { icon: HandCoins, label: "Comissões", path: "/comissoes" },
  { icon: BarChart3, label: "Relatórios", path: "/relatorios" },
  { icon: PackageSearch, label: "Catálogo", path: "/catalogo" },
  { icon: Warehouse, label: "Estoque", path: "/estoque" },
  { icon: ShoppingCart, label: "Compras", path: "/compras" },
  { icon: UsersRound, label: "Clientes", path: "/clientes" },
  { icon: LifeBuoy, label: "Pós-venda", path: "/pos-venda" },
  { icon: Settings, label: "Configurações", path: "/configuracoes" },
  { icon: ScanLine, label: "Operação", path: "/operacao" },
];
const adminItem = { icon: ShieldCheck, label: "Administração", path: "/administracao" };

// Consulta /api/health a cada minuto; o indicador reflete o servidor e o banco.
function useSystemHealth() {
  return useQuery({
    queryKey: ["system-health"],
    queryFn: async () => {
      const response = await fetch("/api/health", { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { database?: string } | null;
      return response.ok && body?.database === "online";
    },
    refetchInterval: 60_000,
    retry: false,
  });
}

// O componente da barra grava "sidebar_state" ao abrir/recolher; lido aqui
// para a escolha valer depois de recarregar a página.
function sidebarStartsOpen() {
  try {
    return !document.cookie.split("; ").includes("sidebar_state=false");
  } catch {
    return true;
  }
}

// No computador, clicar no conteúdo com a barra aberta recolhe para os ícones
// (no celular ela já é uma gaveta que fecha ao tocar fora).
function CollapseSidebarOnOutsideClick() {
  const { isMobile, open, setOpen } = useSidebar();
  useEffect(() => {
    if (isMobile || !open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Só o conteúdo da página: diálogos e menus abrem fora dele, e o botão
      // da barra cuida de si.
      if (!target?.closest("[data-slot=sidebar-inset]") || target.closest("[data-sidebar=trigger]")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isMobile, open, setOpen]);
  return null;
}

type LocalUser ={ id: number; username: string; name: string | null; role: UserRole };

type DashboardLayoutProps = {
  children: React.ReactNode;
  user: LocalUser;
  onLoggedOut?: () => void;
};

export default function DashboardLayout({ children, user, onLoggedOut = () => window.location.replace("/") }: DashboardLayoutProps) {
  const [location, setLocation] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { data: currentUser } = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({ onSuccess: async () => {
    await Promise.all([utils.auth.status.invalidate(), utils.auth.me.invalidate()]);
    onLoggedOut();
  } });
  const isAdmin = user.role === "admin";
  const allowedItems = menuItems.filter((item) => canOpenPage(user.role, item.path));
  const visibleItems = isAdmin ? [...allowedItems, adminItem] : allowedItems;
  // Título vem de todas as páginas: quem abre uma área fora do perfil vê o nome dela, não "não encontrada".
  const activeItem = [...menuItems, adminItem].find((item) => item.path === location || (item.path !== "/" && location.startsWith(item.path)));
  const health = useSystemHealth();
  const healthState = health.isPending ? "checking" : health.data ? "online" : "offline";

  return (
    <SidebarProvider defaultOpen={sidebarStartsOpen()}>
      <CollapseSidebarOnOutsideClick />
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader className="h-[86px] justify-center px-3 group-data-[collapsible=icon]:px-2">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-3 rounded-xl px-2 py-2 text-left outline-none group-data-[collapsible=icon]:p-0 transition hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label="Ir para o painel Luminno"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f4d842] text-[11px] group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:text-[9px] font-black tracking-tighter text-black shadow-sm">
              LUM
            </div>
            <div className="min-w-0 group-data-[collapsible=icon]:hidden">
              <p className="font-display text-base font-bold leading-none tracking-tight">Luminno</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Orçamentos</p>
            </div>
          </button>
        </SidebarHeader>
        <SidebarContent className="px-2 pt-4">
          <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground group-data-[collapsible=icon]:sr-only">Gestão</p>
          <SidebarMenu>
            {visibleItems.map((item) => (
              <SidebarMenuItem key={item.path}>
                <SidebarMenuButton
                  isActive={item.path === "/" ? location === "/" : location.startsWith(item.path)}
                  onClick={() => setLocation(item.path)}
                  tooltip={item.label}
                  className="h-11 rounded-xl px-3 font-medium transition-all"
                >
                  <item.icon className="h-[18px] w-[18px]" />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="gap-3 p-3 group-data-[collapsible=icon]:p-2">
          {isAdmin ? (
            <button
              onClick={() => setLocation("/configuracoes#backup")}
              className="rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3 text-left text-xs transition hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
            >
              <span className="mb-1 flex items-center gap-2 font-semibold"><ArchiveRestore className="h-3.5 w-3.5 text-primary" /> Backup manual</span>
              <span className="block leading-relaxed text-muted-foreground">Baixe uma cópia de todos os dados da loja.</span>
            </button>
          ) : null}
          <button
            onClick={toggleTheme}
            className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          >
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            <span className="group-data-[collapsible=icon]:hidden">Tema {theme === "dark" ? "claro" : "escuro"}</span>
          </button>
          <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"><div className="min-w-0 group-data-[collapsible=icon]:hidden"><p className="truncate font-semibold">{currentUser?.name || user.name || user.username}</p><p className="truncate text-muted-foreground">@{user.username} · {ROLE_LABELS[user.role] ?? user.role}</p></div><button onClick={() => logout.mutate()} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground" aria-label="Sair do sistema"><LogOut className="h-4 w-4" /></button></div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-screen min-w-0 bg-background">
        <header className="sticky top-0 z-30 flex h-[74px] items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-xl md:px-8">
          <SidebarTrigger className="h-9 w-9 rounded-lg border border-border bg-card" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Luminno Iluminação</p>
            <h1 className="truncate font-display text-lg font-bold tracking-tight">{activeItem?.label ?? "Página não encontrada"}</h1>
          </div>
          <div className="ml-auto flex items-center gap-4">
          <div
            role="status"
            className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"
            title={healthState === "offline" ? "O servidor ou o banco de dados não respondeu. Tente recarregar a página." : undefined}
          >
            <span className={`h-2 w-2 rounded-full ${healthState === "online" ? "bg-emerald-500" : healthState === "offline" ? "bg-red-500" : "bg-muted-foreground/50"}`} />
            {healthState === "online" ? "Sistema ativo" : healthState === "offline" ? "Sistema indisponível" : "Verificando…"}
          </div>
          <DailySummaryButton userId={user.id} />
          </div>
        </header>
        <main className="min-w-0 p-4 md:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
