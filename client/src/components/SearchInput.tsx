import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, X } from "lucide-react";

// Campo de busca de lista, com a lupa e o botão de limpar.
export function SearchInput({ value, onChange, ariaLabel, placeholder, className }: { value: string; onChange: (value: string) => void; ariaLabel: string; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="text" className={cn("h-9 pl-9", value ? "pr-9" : "")} aria-label={ariaLabel} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
      {value ? (
        <button type="button" aria-label="Limpar busca" title="Limpar busca" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground" onClick={() => onChange("")}>
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
