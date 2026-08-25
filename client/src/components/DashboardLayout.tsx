import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import {
  ArchiveRestore,
  FileText,
  Files,
  LayoutDashboard,
  LogOut,
  Moon,
  PackageSearch,
  Warehouse,
  Settings,
  ShieldCheck,
  Sun,
  UsersRound,
} from "lucide-react";
import { useLocation } from "wouter";
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
} from "./ui/sidebar";

const menuItems = [
  { icon: LayoutDashboard, label: "Visão geral", path: "/" },
  { icon: FileText, label: "Orçamentos", path: "/orcamentos" },
  { icon: Files, label: "Histórico de PDFs", path: "/historico-pdfs" },
  { icon: PackageSearch, label: "Catálogo", path: "/catalogo" },
  { icon: Warehouse, label: "Estoque", path: "/estoque" },
  { icon: UsersRound, label: "Clientes", path: "/clientes" },
  { icon: Settings, label: "Configurações", path: "/configuracoes" },
];

type LocalUser = { username: string; name: string | null; role: "user" | "admin" };

export default function DashboardLayout({ children, user }: { children: React.ReactNode; user: LocalUser }) {
  const [location, setLocation] = useLocation();
  const { theme, toggleTheme } = useTheme();
  const { data: currentUser } = trpc.auth.me.useQuery();
  const utils = trpc.useUtils();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => { utils.auth.status.invalidate(); utils.auth.me.invalidate(); } });
  const activeItem = menuItems.find((item) => item.path === location || (item.path !== "/" && location.startsWith(item.path)));

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon" className="border-r border-sidebar-border">
        <SidebarHeader className="h-[86px] justify-center px-3">
          <button
            onClick={() => setLocation("/")}
            className="flex items-center gap-3 rounded-xl px-2 py-2 text-left outline-none transition hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            aria-label="Ir para o painel Luminno"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f4d842] text-[11px] font-black tracking-tighter text-black shadow-sm">
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
            {menuItems.map((item) => (
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
            {user.role === "admin" ? <SidebarMenuItem><SidebarMenuButton isActive={location.startsWith("/administracao")} onClick={() => setLocation("/administracao")} tooltip="Administração" className="h-11 rounded-xl px-3 font-medium transition-all"><ShieldCheck className="h-[18px] w-[18px]" /><span>Administração</span></SidebarMenuButton></SidebarMenuItem> : null}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter className="gap-3 p-3">
          <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/50 p-3 text-xs group-data-[collapsible=icon]:hidden">
            <div className="mb-1 flex items-center gap-2 font-semibold"><ArchiveRestore className="h-3.5 w-3.5 text-primary" /> Backup manual</div>
            <p className="leading-relaxed text-muted-foreground">Exporte sua base em JSON nas configurações.</p>
          </div>
          <button
            onClick={toggleTheme}
            className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-sidebar-foreground transition hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:justify-center"
          >
            {theme === "dark" ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
            <span className="group-data-[collapsible=icon]:hidden">Tema {theme === "dark" ? "claro" : "escuro"}</span>
          </button>
          <div className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-xs group-data-[collapsible=icon]:hidden"><div className="min-w-0"><p className="truncate font-semibold">{currentUser?.name || user.name || user.username}</p><p className="truncate text-muted-foreground">@{user.username}</p></div><button onClick={() => logout.mutate()} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-sidebar-accent hover:text-foreground" aria-label="Sair do sistema"><LogOut className="h-4 w-4" /></button></div>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-h-screen bg-background">
        <header className="sticky top-0 z-30 flex h-[74px] items-center gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-xl md:px-8">
          <SidebarTrigger className="h-9 w-9 rounded-lg border border-border bg-card md:hidden" />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">Luminno Iluminação</p>
            <h1 className="truncate font-display text-lg font-bold tracking-tight">{activeItem?.label ?? "Gestão"}</h1>
          </div>
          <div className="ml-auto hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" />Sistema ativo</div>
        </header>
        <main className="min-w-0 p-4 md:p-8">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
