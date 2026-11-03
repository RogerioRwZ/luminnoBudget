import { Input } from "@/components/ui/input";
import { matchesClientSearch } from "@shared/contact";
import { Search, UserRound } from "lucide-react";
import { useState } from "react";

type Client = { id: number; name: string; professional: string; document: string | null; phone: string | null; email: string | null };

// Escolha do cliente cadastrado: busca por nome, profissional, e-mail, CPF/CNPJ
// ou telefone (com ou sem pontuação). Sem escolher, os campos ficam manuais.
export function ClientPicker({ clients, selectedId, onSelect }: { clients: Client[]; selectedId: number | null; onSelect: (client: Client) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = selectedId ? clients.find(client => client.id === selectedId) : undefined;
  const matches = query.trim() ? clients.filter(client => matchesClientSearch(client, query)).slice(0, 8) : [];
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls="client-picker-list"
        aria-label="Buscar cliente cadastrado"
        className="pl-9"
        value={query}
        placeholder={selected ? `Vinculado a ${selected.name}. Busque para trocar` : "Nome, CPF/CNPJ ou telefone"}
        onChange={event => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
      />
      {open && query.trim() ? (
        <ul id="client-picker-list" role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-border bg-popover text-sm shadow-lg">
          {matches.length ? (
            matches.map(client => (
              <li key={client.id} role="option" aria-selected={client.id === selectedId}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => {
                    onSelect(client);
                    setQuery("");
                    setOpen(false);
                  }}
                >
                  <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">
                      {client.name}
                      {client.professional ? <span className="font-normal text-muted-foreground"> — {client.professional}</span> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[client.document, client.phone].filter(Boolean).join(" · ") || "sem CPF/CNPJ e telefone"}
                    </span>
                  </span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-3 text-center text-xs text-muted-foreground">Nenhum cliente encontrado. Preencha os dados abaixo.</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
