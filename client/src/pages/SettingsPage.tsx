import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { parseFiniteNumber, validateSettingsNumbers } from "@shared/formValidation";
import { BellRing, Download, ImagePlus, Save, Upload, X } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { toast } from "sonner";

type SettingsForm = {
  companyName: string; tradingName: string; logoUrl: string; document: string; address: string; phone: string; email: string;
  pixKey: string; pixRecipient: string; defaultPixDiscountMode: "percentage" | "fixed"; defaultPixDiscountValue: number;
  defaultInstallments: number; alertThresholdDays: number; defaultTerms: string;
};

const emptySettings: SettingsForm = {
  companyName: "Luminno Iluminação", tradingName: "Luminno", logoUrl: "", document: "", address: "", phone: "", email: "", pixKey: "", pixRecipient: "",
  defaultPixDiscountMode: "percentage", defaultPixDiscountValue: 0, defaultInstallments: 8, alertThresholdDays: 7,
  defaultTerms: "Valores válidos conforme prazo indicado. Parcelamento sem juros sujeito à análise.",
};

export default function SettingsPage() {
  const utils = trpc.useUtils();
  const { data } = trpc.settings.get.useQuery();
  const [form, setForm] = useState<SettingsForm>(emptySettings);
  const save = trpc.settings.save.useMutation({ onSuccess: () => { utils.settings.get.invalidate(); utils.dashboard.invalidate(); toast.success("Configurações atualizadas"); }, onError: (error) => toast.error(error.message) });
  const uploadLogo = trpc.settings.uploadLogo.useMutation({ onSuccess: (file) => { setForm((current) => ({ ...current, logoUrl: file.url })); toast.success("Logotipo armazenado no servidor. Salve as configurações para aplicá-lo."); }, onError: (error) => toast.error(error.message) });
  const exportBackup = trpc.backup.export.useQuery(undefined, { enabled: false });
  const importBackup = trpc.backup.import.useMutation({ onSuccess: () => { utils.invalidate(); toast.success("Backup restaurado com sucesso"); }, onError: (error) => toast.error(error.message) });

  useEffect(() => {
    if (!data) return;
    setForm({
      companyName: data.companyName, tradingName: data.tradingName, logoUrl: data.logoUrl ?? "", document: data.document ?? "", address: data.address ?? "", phone: data.phone ?? "", email: data.email ?? "",
      pixKey: data.pixKey ?? "", pixRecipient: data.pixRecipient ?? "", defaultPixDiscountMode: data.defaultPixDiscountMode, defaultPixDiscountValue: Number(data.defaultPixDiscountValue),
      defaultInstallments: data.defaultInstallments, alertThresholdDays: data.alertThresholdDays, defaultTerms: data.defaultTerms ?? "",
    });
  }, [data]);

  const logoFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("O logotipo deve ter até 5 MB");
    if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(file.type)) return toast.error("Use um arquivo JPG, PNG ou WEBP");
    const reader = new FileReader();
    reader.onload = () => uploadLogo.mutate({ fileName: file.name, mimeType: file.type as "image/jpeg" | "image/png" | "image/webp", dataUrl: String(reader.result) });
    reader.readAsDataURL(file);
  };
  const download = async () => {
    const result = await exportBackup.refetch();
    if (!result.data) return toast.error("Não foi possível gerar o backup");
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = `luminno-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
    toast.success("Backup exportado em JSON");
  };
  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { const parsed = JSON.parse(String(reader.result)); if (window.confirm("A restauração substituirá os dados atuais. Deseja continuar?")) importBackup.mutate({ data: parsed, replace: true }); } catch { toast.error("Arquivo JSON inválido"); } };
    reader.readAsText(file);
  };

  const handleSave = () => {
    const numberError = validateSettingsNumbers(form);
    if (numberError) return toast.error(numberError);
    if (!form.companyName.trim() || !form.tradingName.trim()) return toast.error("Informe o nome da empresa e o nome de exibição.");
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return toast.error("Informe um e-mail válido.");
    save.mutate(form);
  };

  return <div className="mx-auto max-w-5xl space-y-6">
    <div><p className="eyebrow">Preferências da loja</p><h2 className="page-title">Configurações</h2><p className="page-description">Os dados abaixo são usados nos novos orçamentos e no documento impresso.</p></div>
    <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
      <Card className="border-border/70 shadow-sm"><CardHeader><CardTitle className="font-display text-lg">Dados comerciais</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Razão social / nome da empresa" className="sm:col-span-2"><Input value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} /></Field>
        <Field label="Nome de exibição"><Input value={form.tradingName} onChange={(event) => setForm({ ...form, tradingName: event.target.value })} /></Field>
        <Field label="CNPJ"><Input value={form.document} onChange={(event) => setForm({ ...form, document: event.target.value })} /></Field>
        <Field label="Endereço" className="sm:col-span-2"><Input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></Field>
        <Field label="Telefone"><Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
        <Field label="E-mail"><Input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
        <div className="space-y-2 sm:col-span-2"><Label>Logotipo local</Label><div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-3 sm:flex-row sm:items-center">
          {form.logoUrl ? <img src={form.logoUrl} className="h-16 w-20 rounded-lg border bg-muted object-contain" /> : <div className="grid h-16 w-20 place-items-center rounded-lg bg-muted text-muted-foreground"><ImagePlus className="h-5 w-5" /></div>}
          <div className="min-w-0 flex-1"><p className="text-xs leading-relaxed text-muted-foreground">Envie um arquivo JPG, PNG ou WEBP de até 5 MB. O logotipo fica armazenado no servidor da Luminno e não depende de URL externa.</p><div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild disabled={uploadLogo.isPending}><label><Upload className="mr-2 h-3.5 w-3.5" />{uploadLogo.isPending ? "Enviando…" : "Subir logotipo"}<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={logoFile} /></label></Button>{form.logoUrl ? <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, logoUrl: "" })}><X className="mr-1 h-3.5 w-3.5" />Remover</Button> : null}</div></div>
        </div></div>
      </CardContent></Card>
      <Card className="border-border/70 shadow-sm"><CardHeader><CardTitle className="font-display text-lg">Pagamento e alertas</CardTitle></CardHeader><CardContent className="space-y-4">
        <Field label="Chave PIX"><Input value={form.pixKey} onChange={(event) => setForm({ ...form, pixKey: event.target.value })} /></Field>
        <Field label="Favorecido PIX"><Input value={form.pixRecipient} onChange={(event) => setForm({ ...form, pixRecipient: event.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Desconto PIX"><Input type="number" min="0" value={form.defaultPixDiscountValue} onChange={(event) => setForm({ ...form, defaultPixDiscountValue: parseFiniteNumber(event.target.value) })} /></Field><Field label="Tipo"><Select value={form.defaultPixDiscountMode} onValueChange={(value: "percentage" | "fixed") => setForm({ ...form, defaultPixDiscountMode: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="percentage">Percentual</SelectItem><SelectItem value="fixed">Valor fixo</SelectItem></SelectContent></Select></Field></div>
        <Field label="Parcelas sem juros"><Input type="number" min="1" max="24" value={form.defaultInstallments} onChange={(event) => setForm({ ...form, defaultInstallments: parseFiniteNumber(event.target.value) })} /></Field>
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><div className="flex gap-2"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" /><div className="min-w-0 flex-1"><Label>Antecedência do alerta</Label><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Mostra no Dashboard as propostas pendentes que vencem dentro desse período.</p><div className="mt-3 flex items-center gap-2"><Input type="number" min="1" max="60" value={form.alertThresholdDays} onChange={(event) => setForm({ ...form, alertThresholdDays: Math.min(60, Math.max(1, parseFiniteNumber(event.target.value) || 1)) })} className="w-20 bg-background" /><span className="text-sm font-medium">dias antes do vencimento</span></div></div></div></div>
      </CardContent></Card>
      <Card className="border-border/70 shadow-sm lg:col-span-2"><CardHeader><CardTitle className="font-display text-lg">Observações comerciais padrão</CardTitle></CardHeader><CardContent><Textarea value={form.defaultTerms} onChange={(event) => setForm({ ...form, defaultTerms: event.target.value })} rows={4} /><div className="mt-4 flex justify-end"><Button disabled={save.isPending || uploadLogo.isPending} onClick={handleSave}><Save className="mr-2 h-4 w-4" />Salvar configurações</Button></div></CardContent></Card>
      <Card className="border-border/70 shadow-sm lg:col-span-2"><CardHeader><CardTitle className="font-display text-lg">Backup e restauração manual</CardTitle></CardHeader><CardContent className="flex flex-col gap-4 rounded-b-xl bg-muted/25 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Base de dados em JSON</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Exporte uma cópia completa antes de qualquer alteração relevante. A importação substitui a base atual.</p></div><div className="flex shrink-0 gap-2"><Button variant="outline" onClick={download} disabled={exportBackup.isFetching}><Download className="mr-2 h-4 w-4" />Exportar JSON</Button><Button variant="outline" asChild disabled={importBackup.isPending}><label><Upload className="mr-2 h-4 w-4" />Importar JSON<input className="sr-only" type="file" accept="application/json" onChange={importFile} /></label></Button></div></CardContent></Card>
    </div>
  </div>;
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) { return <div className={`space-y-2 ${className ?? ""}`}><Label>{label}</Label>{children}</div>; }
