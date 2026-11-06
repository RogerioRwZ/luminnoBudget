import { Button } from "@/components/ui/button";

export function ShowMoreButton({ remaining, onClick }: { remaining: number; onClick: () => void; pageSize?: number }) {
  if (remaining <= 0) return null;
  return (
    <div className="p-3 text-center">
      <Button variant="outline" size="sm" onClick={onClick}>
        Ver mais ({remaining.toLocaleString("pt-BR")} restantes)
      </Button>
    </div>
  );
}
