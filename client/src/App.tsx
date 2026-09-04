import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import AuthPage from "@/pages/AuthPage";
import { Route, Switch } from "wouter";
import { lazy, Suspense } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

// Cada página roteada vira seu próprio "chunk" JS, carregado sob demanda ao
// navegar até ela — em vez de todas (e suas dependências, como jsPDF) irem
// juntas no bundle inicial que todo mundo baixa só para abrir o sistema.
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const CustomersPage = lazy(() => import("@/pages/CustomersPage"));
const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const FinancePage = lazy(() => import("@/pages/FinancePage"));
const InventoryPage = lazy(() => import("@/pages/InventoryPage"));
const NotFound = lazy(() => import("@/pages/NotFound"));
const OperationsPage = lazy(() => import("@/pages/OperationsPage"));
const PdfHistoryPage = lazy(() => import("@/pages/PdfHistoryPage"));
const ProductsPage = lazy(() => import("@/pages/ProductsPage"));
const QuoteEditorPage = lazy(() => import("@/pages/QuoteEditorPage"));
const QuotesPage = lazy(() => import("@/pages/QuotesPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));

const RouteFallback = () => (
  <div className="grid min-h-[50vh] place-items-center text-sm text-muted-foreground">
    Carregando…
  </div>
);

export function Router() {
  const { data, isLoading, error } = trpc.auth.status.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  if (isLoading) return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Verificando acesso seguro…</div>;
  if (error || !data) return <div className="grid min-h-screen place-items-center bg-background p-6 text-center"><div><p className="font-display text-xl font-bold">Não foi possível verificar o acesso.</p><p className="mt-2 text-sm text-muted-foreground">Confirme a conexão com o banco de dados e tente novamente.</p></div></div>;
  if (!data.user) return <AuthPage setupRequired={data.setupRequired} />;
  return (
    <DashboardLayout user={data.user}>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={DashboardPage} />
          <Route path="/orcamentos" component={QuotesPage} />
          <Route path="/orcamentos/novo" component={QuoteEditorPage} />
          <Route path="/orcamentos/:id" component={QuoteEditorPage} />
          <Route path="/historico-pdfs" component={PdfHistoryPage} />
          <Route path="/financeiro" component={FinancePage} />
          <Route path="/catalogo" component={ProductsPage} />
          <Route path="/estoque" component={InventoryPage} />
          <Route path="/clientes" component={CustomersPage} />
          <Route path="/configuracoes" component={SettingsPage} />
          <Route path="/operacao" component={OperationsPage} />
          <Route path="/administracao" component={AdminPage} />
          <Route component={NotFound} />
        </Switch>
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
