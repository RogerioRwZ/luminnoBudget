import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import AdminPage from "@/pages/AdminPage";
import AuthPage from "@/pages/AuthPage";
import CustomersPage from "@/pages/CustomersPage";
import DashboardPage from "@/pages/DashboardPage";
import InventoryPage from "@/pages/InventoryPage";
import NotFound from "@/pages/NotFound";
import ProductsPage from "@/pages/ProductsPage";
import QuoteEditorPage from "@/pages/QuoteEditorPage";
import QuotesPage from "@/pages/QuotesPage";
import SettingsPage from "@/pages/SettingsPage";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function Router() {
  const { data, isLoading, error } = trpc.auth.status.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  if (isLoading) return <div className="grid min-h-screen place-items-center bg-background text-sm text-muted-foreground">Verificando acesso seguro…</div>;
  if (error || !data) return <div className="grid min-h-screen place-items-center bg-background p-6 text-center"><div><p className="font-display text-xl font-bold">Não foi possível verificar o acesso.</p><p className="mt-2 text-sm text-muted-foreground">Confirme a conexão com o banco de dados e tente novamente.</p></div></div>;
  if (!data.user) return <AuthPage setupRequired={data.setupRequired} />;
  return (
    <DashboardLayout user={data.user}>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/orcamentos" component={QuotesPage} />
        <Route path="/orcamentos/novo" component={QuoteEditorPage} />
        <Route path="/orcamentos/:id" component={QuoteEditorPage} />
        <Route path="/catalogo" component={ProductsPage} />
        <Route path="/estoque" component={InventoryPage} />
        <Route path="/clientes" component={CustomersPage} />
        <Route path="/configuracoes" component={SettingsPage} />
        <Route path="/administracao" component={AdminPage} />
        <Route component={NotFound} />
      </Switch>
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
