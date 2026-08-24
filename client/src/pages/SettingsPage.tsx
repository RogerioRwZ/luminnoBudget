import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import { BellRing, Download, ImagePlus, Save, Upload, X } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { toast } from "sonner";

type SettingsForm = {
  companyName: string;
  tradingName: string;
  logoUrl: string | null;
  document: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  pixKey: string | null;
  pixRecipient: string | null;
  defaultPixDiscountMode: "percentage" | "fixed";
  defaultPixDiscountValue: number;
  defaultInstallments: number;
  alertThresholdDays: number;
  defaultTerms: string | null;
};

const emptySettings: SettingsForm = {
  companyName: "Luminno Iluminação",
  tradingName: "Luminno",
  logoUrl: null,
  document: null,
  address: null,
  phone: null,
  email: null,
  pixKey: null,
  pixRecipient: null,
  defaultPixDiscountMode: "percentage",
  defaultPixDiscountValue: 0,
  defaultInstallments: 8,
  alertThresholdDays: 7,
  defaultTerms: "Valores válidos conforme prazo indicado. Parcelamento sem juros sujeito à análise.",
};

export default function SettingsPage() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settings.get.useQuery();
  const [form, setForm] = useState<SettingsForm>(emptySettings);
  const [hasChanges, setHasChanges] = useState(false);

  const save = trpc.settings.save.useMutation({
    onSuccess: () => {
      utils.settings.get.invalidate();
      utils.dashboard.invalidate();
      setHasChanges(false);
      toast.success("Configurações atualizadas com sucesso");
    },
    onError: (error) => toast.error(error.message || "Erro ao salvar configurações"),
  });

  const uploadLogo = trpc.settings.uploadLogo.useMutation({
    onSuccess: (file) => {
      setForm((current) => ({ ...current, logoUrl: file.url }));
      setHasChanges(true);
      toast.success("Logotipo enviado. Clique em Salvar para confirmar");
    },
    onError: (error) => toast.error(error.message || "Erro ao enviar logotipo"),
  });

  const exportBackup = trpc.backup.export.useQuery(undefined, { enabled: false });
  const importBackup = trpc.backup.import.useMutation({
    onSuccess: () => {
      utils.invalidate();
      toast.success("Backup restaurado com sucesso");
    },
    onError: (error) => toast.error(error.message || "Erro ao restaurar backup"),
  });

  useEffect(() => {
    if (!data) return;
    setForm({
      companyName: data.companyName,
      tradingName: data.tradingName,
      logoUrl: data.logoUrl ?? null,
      document: data.document ?? null,
      address: data.address ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      pixKey: data.pixKey ?? null,
      pixRecipient: data.pixRecipient ?? null,
      defaultPixDiscountMode: data.defaultPixDiscountMode,
      defaultPixDiscountValue: Number(data.defaultPixDiscountValue),
      defaultInstallments: data.defaultInstallments,
      alertThresholdDays: data.alertThresholdDays,
      defaultTerms: data.defaultTerms ?? null,
    });
    setHasChanges(false);
  }, [data]);

  const logoFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("O logotipo deve ter até 5 MB");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
      return toast.error("Use um arquivo JPG, PNG ou WEBP");
    const reader = new FileReader();
    reader.onload = () =>
      uploadLogo.mutate({
        fileName: file.name,
        mimeType: file.type as "image/jpeg" | "image/png" | "image/webp",
        dataUrl: String(reader.result),
      });
    reader.readAsDataURL(file);
  };

  const removeLogo = () => {
    setForm((current) => ({ ...current, logoUrl: null }));
    setHasChanges(true);
  };

  const download = async () => {
    const result = await exportBackup.refetch();
    if (!result.data) return toast.error("Não foi possível gerar o backup");
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `luminno-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Backup exportado em JSON");
  };

  const importFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (window.confirm("A restauração substituirá os dados atuais. Deseja continuar?"))
          importBackup.mutate({ data: parsed });
      } catch (error) {
        toast.error("Arquivo de backup inválido");
      }
    };
    reader.readAsText(file);
  };

  const handleSave = () => {
    if (!form.companyName.trim()) {
      return toast.error("Informe o nome da empresa");
    }
    if (!form.tradingName.trim()) {
      return toast.error("Informe o nome de exibição");
    }
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      return toast.error("Informe um e-mail válido");
    }

    save.mutate({
      companyName: form.companyName.trim(),
      tradingName: form.tradingName.trim(),
      logoUrl: form.logoUrl,
      document: form.document?.trim() || null,
      address: form.address?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      pixKey: form.pixKey?.trim() || null,
      pixRecipient: form.pixRecipient?.trim() || null,
      defaultPixDiscountMode: form.defaultPixDiscountMode,
      defaultPixDiscountValue: form.defaultPixDiscountValue,
      defaultInstallments: form.defaultInstallments,
      alertThresholdDays: form.alertThresholdDays,
      defaultTerms: form.defaultTerms?.trim() || null,
    });
  };

  const handleFieldChange = (field: keyof SettingsForm, value: any) => {
    setForm((current) => ({ ...current, [field]: value }));
    setHasChanges(true);
  };

  if (isLoading) {
    return <div className="mx-auto max-w-5xl space-y-6">Carregando...</div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="eyebrow">Preferências da loja</p>
        <h2 className="page-title">Configurações</h2>
        <p className="page-description">Os dados abaixo são usados nos novos orçamentos e nos documentos enviados ao cliente.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
        {/* Dados Comerciais */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-lg">Dados comerciais</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Razão social / nome da empresa" className="sm:col-span-2">
              <Input
                value={form.companyName}
                onChange={(e) => handleFieldChange("companyName", e.target.value)}
                placeholder="Ex: Empresa LTDA"
              />
            </Field>
            <Field label="Nome de exibição">
              <Input
                value={form.tradingName}
                onChange={(e) => handleFieldChange("tradingName", e.target.value)}
                placeholder="Ex: Empresa"
              />
            </Field>
            <Field label="CNPJ">
              <Input
                value={form.document || ""}
                onChange={(e) => handleFieldChange("document", e.target.value)}
                placeholder="00.000.000/0000-00"
              />
            </Field>
            <Field label="Endereço" className="sm:col-span-2">
              <Input
                value={form.address || ""}
                onChange={(e) => handleFieldChange("address", e.target.value)}
                placeholder="Rua, número, complemento"
              />
            </Field>
            <Field label="Telefone">
              <Input
                value={form.phone || ""}
                onChange={(e) => handleFieldChange("phone", e.target.value)}
                placeholder="(00) 0000-0000"
              />
            </Field>
            <Field label="E-mail">
              <Input
                type="email"
                value={form.email || ""}
                onChange={(e) => handleFieldChange("email", e.target.value)}
                placeholder="contato@empresa.com"
              />
            </Field>
            <div className="space-y-2 sm:col-span-2">
              <Label>Logotipo local</Label>
              <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-3 sm:flex-row sm:items-center">
                {form.logoUrl ? (
                  <>
                    <img
                      src={form.logoUrl}
                      className="h-16 w-20 rounded-lg border bg-muted object-contain"
                      alt="Logotipo da empresa"
                    />
                    <button
                      onClick={removeLogo}
                      className="absolute ml-12 rounded-full bg-red-500 p-1 text-white hover:bg-red-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <div className="grid h-16 w-20 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <ImagePlus className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Envie um arquivo JPG, PNG ou WEBP de até 5 MB. O logotipo fica armazenado no servidor da Luminno.
                  </p>
                  <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90">
                    <Upload className="h-4 w-4" />
                    Enviar arquivo
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={logoFile}
                      disabled={uploadLogo.isPending}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pagamento e Alertas */}
        <Card className="border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-lg">Pagamento e alertas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Chave PIX">
              <Input
                value={form.pixKey || ""}
                onChange={(e) => handleFieldChange("pixKey", e.target.value)}
                placeholder="00000000-0000-0000-0000-000000000000"
              />
            </Field>
            <Field label="Favorecido PIX">
              <Input
                value={form.pixRecipient || ""}
                onChange={(e) => handleFieldChange("pixRecipient", e.target.value)}
                placeholder="Nome do favorecido"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Desconto PIX (%)">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.defaultPixDiscountValue}
                  onChange={(e) => handleFieldChange("defaultPixDiscountValue", Number(e.target.value))}
                />
              </Field>
              <Field label="Modo desconto PIX">
                <Select value={form.defaultPixDiscountMode} onValueChange={(v) => handleFieldChange("defaultPixDiscountMode", v as "percentage" | "fixed")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Percentual (%)</SelectItem>
                    <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Parcelas sem juros">
              <Input
                type="number"
                min="1"
                max="24"
                value={form.defaultInstallments}
                onChange={(e) => handleFieldChange("defaultInstallments" , Number(e.target.value))}
              />
            </Field>
            <Field label="Dias de alerta (vencimento)">
              <Input
                type="number"
                min="1"
                max="60"
                value={form.alertThresholdDays}
                onChange={(e) => handleFieldChange("alertThresholdDays", Number(e.target.value))}
              />
            </Field>
          </CardContent>
        </Card>

        {/* Observações Comerciais */}
        <Card className="border-border/70 shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Observações comerciais padrão</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={4}
              value={form.defaultTerms || ""}
              onChange={(e) => handleFieldChange("defaultTerms", e.target.value)}
              placeholder="Texto padrão exibido nos orçamentos"
              className="resize-none"
            />
          </CardContent>
        </Card>

        {/* Backup */}
        <Card className="border-border/70 shadow-sm lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-lg">Backup e restauração manual</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-3">
            <Button
              variant="outline"
              onClick={download}
              disabled={exportBackup.isLoading}
              className="flex-1"
            >
              <Download className="mr-2 h-4 w-4" />
              Exportar backup
            </Button>
            <label className="flex-1">
              <Button variant="outline" asChild className="w-full">
                <span>
                  <Upload className="mr-2 h-4 w-4" />
                  Importar backup
                  <input
                    type="file"
                    accept=".json"
                    onChange={importFile}
                    disabled={importBackup.isPending}
                    className="hidden"
                  />
                </span>
              </Button>
            </label>
          </CardContent>
        </Card>

        {/* Botão Salvar */}
        <div className="flex gap-3 lg:col-span-2">
          <Button
            onClick={handleSave}
            disabled={!hasChanges || save.isPending || isLoading}
            className="flex-1"
          >
            <Save className="mr-2 h-4 w-4" />
            {save.isPending ? "Salvando..." : "Salvar alterações"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
