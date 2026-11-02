import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateInput } from "@/lib/format";

export type PeriodPreset = "this_month" | "last_month" | "last_3_months" | "this_year" | "custom";
export type Period = { preset: PeriodPreset; from: string; to: string };

const PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: "Este mês",
  last_month: "Mês passado",
  last_3_months: "Últimos 3 meses",
  this_year: "Este ano",
  custom: "Personalizado",
};

// Datas em "aaaa-mm-dd", com o fim inclusivo (o último dia conta inteiro).
export function presetPeriod(preset: Exclude<PeriodPreset, "custom">, now = new Date()): Period {
  const y = now.getFullYear();
  const m = now.getMonth();
  const ranges = {
    this_month: [new Date(y, m, 1), new Date(y, m + 1, 0)],
    last_month: [new Date(y, m - 1, 1), new Date(y, m, 0)],
    last_3_months: [new Date(y, m - 2, 1), new Date(y, m + 1, 0)],
    this_year: [new Date(y, 0, 1), new Date(y, 11, 31)],
  } as const;
  const [from, to] = ranges[preset];
  return { preset, from: formatDateInput(from), to: formatDateInput(to) };
}

// Intervalo para o servidor: do início do primeiro dia até o fim do último.
export function periodRange(period: Period) {
  const [fy, fm, fd] = period.from.split("-").map(Number);
  const [ty, tm, td] = period.to.split("-").map(Number);
  return { from: new Date(fy!, fm! - 1, fd!), to: new Date(ty!, tm! - 1, td! + 1) };
}

export function isValidPeriod(period: Period) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period.from) || !/^\d{4}-\d{2}-\d{2}$/.test(period.to)) return false;
  const range = periodRange(period);
  return range.to > range.from && range.to.getTime() - range.from.getTime() <= 366 * 24 * 60 * 60_000;
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (period: Period) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1.5">
        <Label className="text-xs">Período</Label>
        <Select
          value={value.preset}
          onValueChange={(preset: PeriodPreset) => onChange(preset === "custom" ? { ...value, preset } : presetPeriod(preset))}
        >
          <SelectTrigger className="h-9 w-44" aria-label="Período">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(PRESET_LABELS) as PeriodPreset[]).map(preset => (
              <SelectItem key={preset} value={preset}>{PRESET_LABELS[preset]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="period-from" className="text-xs">De</Label>
        <Input id="period-from" type="date" className="h-9 w-40" value={value.from} onChange={event => onChange({ preset: "custom", from: event.target.value, to: value.to })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="period-to" className="text-xs">Até</Label>
        <Input id="period-to" type="date" className="h-9 w-40" value={value.to} onChange={event => onChange({ preset: "custom", from: value.from, to: event.target.value })} />
      </div>
    </div>
  );
}
