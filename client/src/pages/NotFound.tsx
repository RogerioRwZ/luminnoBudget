import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Compass, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Card className="w-full max-w-lg border-border/70 shadow-sm">
        <CardContent className="p-8 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-[#f4d842] text-black shadow-sm">
            <Compass className="h-7 w-7" />
          </span>
          <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Erro 404
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight">
            Esta página não existe
          </h2>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
            O endereço pode ter sido digitado errado ou a página foi removida.
            Use o menu ao lado ou volte para a visão geral.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Button variant="outline" onClick={() => window.history.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Voltar
            </Button>
            <Button onClick={() => setLocation("/")}>
              <Home className="mr-2 h-4 w-4" />
              Ir para a visão geral
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
