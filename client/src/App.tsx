import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import AuthPage from "@/pages/AuthPage";
import { Route, Switch, useLocation } from "wouter";
import { canOpenPage } from "@shared/permissions";
import { ShieldAlert } from "lucide-react";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { setDraftOwner } from "./hooks/useDraftAutosave";

// Cada página roteada vira seu próprio "chunk" JS, carregado sob demanda ao
// navegar até ela — em vez de todas (e suas dependências, como jsPDF) irem
// juntas no bundle inicial que todo mundo baixa só para abrir o sistema.
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const AgendaPage = lazy(() => import("@/pages/AgendaPage"));
const CommissionsPage = lazy(() => import("@/pages/CommissionsPage"));
const ReportsPage = lazy(() => import("@/pages/ReportsPage"));
const AfterSalesPage = lazy(() => import("@/pages/AfterSalesPage"));
const StockTurnoverPage = lazy(() => import("@/pages/StockTurnoverPage"));
const LoansPage = lazy(() => import("@/pages/LoansPage"));
const CustomersPage = lazy(() => import("@/pages/CustomersPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const FinancePage = lazy(() => import("@/pages/FinancePage"));
const InventoryPage = lazy(() => import("@/pages/InventoryPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const OperationsPage = lazy(() => import("@/pages/OperationsPage"));
const PdfHistoryPage = lazy(() => import("@/pages/PdfHistoryPage"));
const PickingCheckPage = lazy(() => import("@/pages/PickingCheckPage"));
const ProductsPage = lazy(() => import("@/pages/ProductsPage"));
const PurchasesPage = lazy(() => import("@/pages/PurchasesPage"));
const QuoteEditorPage = lazy(() => import("@/pages/QuoteEditorPage"));
const QuotesPage = lazy(() => import("@/pages/QuotesPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));

const RouteFallback = () => (
  <div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">
    Carregando…
  </div>
);

function NoAccess() {
  return (
    <div className="grid min-h-[60vh] place-items-center text-center">
      <div className="max-w-sm">
        <ShieldAlert className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="mt-4 font-display text-xl font-bold">Área fora do seu perfil</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Seu perfil de acesso não inclui esta página. Se precisar dela, peça
          ao administrador para ajustar o seu perfil.
        </p>
      </div>
    </div>
  );
}

export function Router() {
  const [location] = useLocation();
  const { data, isLoading, error } = trpc.auth.status.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  if (isLoading) return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Verificando acesso seguro…</div>;
  if (error || !data) return <div className="grid min-h-screen place-items-center bg-background p-6 text-center"><div><p className="font-display text-xl font-bold">Não foi possível verificar o acesso.</p><p className="mt-2 text-sm text-muted-foreground">Confirme a conexão com o banco de dados e tente novamente.</p></div></div>;
  if (!data.user) return <AuthPage setupRequired={data.setupRequired} />;
  setDraftOwner(data.user.id);
  return (
    <DashboardLayout user={data.user}>
      <Suspense fallback={<RouteFallback />}>
        {!canOpenPage(data.user.role, location) ? <NoAccess /> : <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/orcamentos" component={QuotesPage} />
          <Route path="/orcamentos/novo" component={QuoteEditorPage} />
          <Route path="/orcamentos/:id" component={QuoteEditorPage} />
          <Route path="/historico-pdfs" component={PdfHistoryPage} />
          <Route path="/financeiro" component={FinancePage} />
          <Route path="/comissoes" component={CommissionsPage} />
          <Route path="/relatorios" component={ReportsPage} />
          <Route path="/pos-venda" component={AfterSalesPage} />
          <Route path="/mostruario" component={LoansPage} />
          <Route path="/catalogo" component={ProductsPage} />
          <Route path="/estoque" component={InventoryPage} />
          <Route path="/estoque/conferencia/:id" component={PickingCheckPage} />
          <Route path="/estoque/giro" component={StockTurnoverPage} />
          <Route path="/compras" component={PurchasesPage} />
          <Route path="/agenda" component={AgendaPage} />
          <Route path="/clientes" component={CustomersPage} />
          <Route path="/configuracoes" component={SettingsPage} />
          <Route path="/operacao" component={OperationsPage} />
          <Route path="/administracao" component={AdminPage} />
          <Route component={NotFound} />
        </Switch>}
      </Suspense>
    </DashboardLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light" switchable>
        <TooltipProvider>
          <Toaster richColors position="top-right" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
