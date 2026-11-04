import { Button } from "@/components/ui/button";

export function ShowMoreButton({ remaining, onClick, pageSize = 50 }: { remaining: number; onClick: () => void; pageSize?: number }) {
  if (remaining <= 0) return null;
  return (
    <div className="p-3 text-center">
      <Button variant="outline" size="sm" onClick={onClick}>
        Mostrar mais {Math.min(remaining, pageSize)} (faltam {remaining.toLocaleString("pt-BR")})
      </Button>
    </div>
  );
}
