import { foldText } from "@shared/productCodes";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Check, Search, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";

export type SearchableOption = { value: string; label: string; hint?: string; searchText?: string };

const MAX_RESULTS = 50;

// Lista grande em que se digita para achar. A lista abre dentro do fluxo da
// página, e não flutuando, para não ser cortada em janelas com rolagem. Abre ao
// clicar ou digitar, não ao receber foco: a janela que foca o campo sozinho não
// deve empurrar os outros campos para baixo.
export function SearchableSelect({ id, value, options, onChange, ariaLabel, placeholder = "Digite para buscar", clearLabel, emptyMessage = "Nada encontrado.", disabled, action, className }: {
  id?: string;
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  // Quando informado, dá para deixar sem escolha.
  clearLabel?: string;
  emptyMessage?: string;
  disabled?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const selected = options.find((option) => option.value === value);
  const matches = useMemo(() => {
    const words = foldText(text).split(/\s+/).filter(Boolean);
    return options.filter((option) => {
      const haystack = foldText(`${option.label} ${option.hint ?? ""} ${option.searchText ?? ""}`);
      return words.every((word) => haystack.includes(word));
    });
  }, [options, text]);
  const shown = matches.slice(0, MAX_RESULTS);
  const close = () => { setOpen(false); setText(""); setActive(0); };
  const choose = (option: SearchableOption) => { onChange(option.value); close(); input.current?.blur(); };

  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            ref={input}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            disabled={disabled}
            className={cn("h-10 pl-9", value && clearLabel ? "pr-9" : "")}
            placeholder={selected ? selected.label : placeholder}
            value={open ? text : selected?.label ?? ""}
            onClick={() => setOpen(true)}
            onBlur={close}
            onChange={(event) => { setText(event.target.value); setActive(0); setOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive((current) => Math.min(current + 1, Math.max(0, shown.length - 1))); }
              else if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => Math.max(current - 1, 0)); }
              else if (event.key === "Enter" && open) { event.preventDefault(); if (shown[active]) choose(shown[active]!); }
              else if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); input.current?.blur(); }
            }}
          />
          {value && clearLabel && !disabled ? (
            <button type="button" aria-label={clearLabel} title={clearLabel} className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); close(); }}>
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        {action}
      </div>
      {open ? (
        <div id={listId} role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-sm" onMouseDown={(event) => event.preventDefault()}>
          {shown.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent", index === active ? "bg-accent" : "")}
              onClick={() => choose(option)}
            >
              <span className="min-w-0 flex-1">
                <span className="block break-words">{option.label}</span>
                {option.hint ? <span className="block text-xs text-muted-foreground">{option.hint}</span> : null}
              </span>
              {option.value === value ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
            </button>
          ))}
          {!shown.length ? <p className="px-3 py-3 text-sm text-muted-foreground">{emptyMessage}</p> : null}
          {matches.length > shown.length ? <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">Mostrando {shown.length} de {matches.length.toLocaleString("pt-BR")}. Digite mais para refinar.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
