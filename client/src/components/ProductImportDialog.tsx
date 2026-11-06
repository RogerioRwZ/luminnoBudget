import { FormError, getFormErrorMessage } from "@/components/FormFeedback";
import { ShowMoreButton } from "@/components/ShowMoreButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useVisibleItems } from "@/hooks/useVisibleItems";
import { catalogTemplate, errorSheet } from "@/lib/catalogTemplate";
import { isSupportedImage, prepareImage, renameForType } from "@/lib/shrinkImage";
import { trpc } from "@/lib/trpc";
import { downloadXlsx, readXlsx, XlsxError } from "@/lib/xlsx";
import { plural } from "@shared/plural";
import { IMPORT_MAX_ROWS, parseImportSheet, photoKey, photoReport, supplierKey, unknownSuppliers, type CatalogEntry, type ImportRow } from "@shared/productImport";
import { AlertTriangle, Download, FileSpreadsheet, ImagePlus, Upload } from "lucide-react";
import { useMemo, useState } from "react";

const BATCH = 200;
const MAX_FILE = 25 * 1024 * 1024;

type Decision = { action: "create" } | { action: "replace"; to: string } | null;
type Outcome = { line: number; reference: string; status: "created" | "updated" | "skipped" | "error"; message?: string };
type Step = "start" | "review" | "running" | "done";

export function ProductImportDialog({ catalog, suppliers, canSeeCost, canStock, onClose }: {
  catalog: CatalogEntry[];
  suppliers: string[];
  canSeeCost: boolean;
  canStock: boolean;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const importRows = trpc.product.importRows.useMutation();
  const uploadImage = trpc.product.uploadImage.useMutation();
  const access = { canSeeCost, canStock };
  const [step, setStep] = useState<Step>("start");
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"skip" | "update">("skip");
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [progress, setProgress] = useState({ done: 0, total: 0, label: "" });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);

  const invalid = useMemo(() => rows.filter((row) => row.problems.length), [rows]);
  const valid = useMemo(() => rows.filter((row) => !row.problems.length), [rows]);
  const existing = useMemo(() => valid.filter((row) => row.existing), [valid]);
  // Linha ignorada não grava nada: o fornecedor dela não precisa de decisão.
  const toSave = useMemo(() => valid.filter((row) => !row.existing || mode === "update"), [valid, mode]);
  const unknown = useMemo(() => unknownSuppliers(toSave, suppliers), [toSave, suppliers]);
  const undecided = unknown.filter((item) => !decisions[supplierKey(item.name)]).length;
  const photoNames = useMemo(() => photos.map((file) => file.name), [photos]);
  const photoInfo = useMemo(() => photoReport(toSave, photoNames), [toSave, photoNames]);
  const missingPhoto = useMemo(() => new Set(photoInfo.missing.map((item) => item.line)), [photoInfo]);
  const attention = useMemo(() => [...invalid, ...valid.filter((row) => row.warnings.length || row.existing || missingPhoto.has(row.line))], [invalid, valid, missingPhoto]);
  const list = useVisibleItems(attention, rows, 50);

  async function review() {
    if (!sheetFile) return;
    setError(null);
    try {
      if (sheetFile.size > MAX_FILE) throw new XlsxError("A planilha é grande demais (máximo de 25 MB).");
      const sheets = await readXlsx(new Uint8Array(await sheetFile.arrayBuffer()));
      const sheet = sheets.find((item) => supplierKey(item.name) === "produtos") ?? sheets[0];
      if (!sheet) throw new XlsxError("A planilha está vazia.");
      const parsed = parseImportSheet(sheet.rows, { catalog, ...access });
      if (parsed.error) throw new XlsxError(parsed.error);
      if (!parsed.rows.length) throw new XlsxError("Nenhum produto preenchido. A linha de exemplo não conta.");
      if (parsed.rows.length > IMPORT_MAX_ROWS) throw new XlsxError(`A planilha tem ${parsed.rows.length.toLocaleString("pt-BR")} produtos. O limite é ${IMPORT_MAX_ROWS.toLocaleString("pt-BR")} por vez: divida em mais de um arquivo.`);
      setRows(parsed.rows);
      setDecisions({});
      setMode("skip");
      setStep("review");
    } catch (failure) {
      setError(failure instanceof XlsxError ? failure.message : "Não foi possível ler esta planilha. Salve como .xlsx e tente de novo.");
    }
  }

  // Grafia do cadastro para quem já existe ("acme" vira "ACME") e a decisão
  // tomada para os novos.
  function supplierFor(name: string | undefined) {
    if (!name) return undefined;
    const typed = supplierKey(name);
    const registered = suppliers.find((supplier) => supplierKey(supplier) === typed);
    if (registered) return registered;
    const decision = decisions[typed];
    if (decision?.action === "replace") return decision.to;
    return unknown.find((item) => supplierKey(item.name) === typed)?.name ?? name;
  }

  async function run() {
    setStep("running");
    setFatal(null);
    const results: Outcome[] = [];
    const uploaded = new Map<string, Promise<{ url: string; key: string }>>();
    const uploadPhoto = (file: File) => {
      const id = photoKey(file.name);
      const pending = uploaded.get(id) ?? (async () => {
        if (!isSupportedImage(file.type)) throw new Error("Foto em formato não aceito. Use JPG, PNG ou WEBP.");
        const prepared = await prepareImage(file);
        const saved = await uploadImage.mutateAsync({ fileName: renameForType(file.name, prepared.mimeType).slice(-120), mimeType: prepared.mimeType, dataUrl: prepared.dataUrl });
        return { url: saved.url, key: saved.key };
      })();
      uploaded.set(id, pending);
      return pending;
    };
    const byPhoto = new Map(photos.map((file) => [photoKey(file.name), file]));
    const skipped = valid.filter((row) => row.existing && mode === "skip");
    results.push(...skipped.map((row) => ({ line: row.line, reference: row.data.reference, status: "skipped" as const, message: "Já existe no catálogo." })));
    try {
      setProgress({ done: 0, total: toSave.length, label: "Gravando" });
      for (let start = 0; start < toSave.length; start += BATCH) {
        const batch = toSave.slice(start, start + BATCH);
        const payload: Array<ImportRow["data"]> = [];
        for (let index = 0; index < batch.length; index += 1) {
          const row = batch[index]!;
          const file = row.photo ? byPhoto.get(photoKey(row.photo)) : undefined;
          const data = { ...row.data, supplierName: supplierFor(row.data.supplierName) };
          if (file) {
            setProgress({ done: start + index, total: toSave.length, label: `Enviando a foto ${file.name}` });
            try {
              const image = await uploadPhoto(file);
              data.imageUrl = image.url;
              data.imageKey = image.key;
            } catch (failure) {
              results.push({ line: row.line, reference: row.data.reference, status: "error", message: `Foto ${file.name}: ${getFormErrorMessage(failure, "não foi possível enviar.")}` });
              continue;
            }
          }
          payload.push(data);
        }
        setProgress({ done: start, total: toSave.length, label: "Gravando" });
        if (payload.length) results.push(...(await importRows.mutateAsync({ mode, rows: payload })));
        setProgress({ done: Math.min(start + BATCH, toSave.length), total: toSave.length, label: "Gravando" });
      }
    } catch (failure) {
      // O que já foi gravado fica: reenviar a planilha com "ignorar" não duplica.
      const answered = new Set(results.map((result) => result.line));
      setFatal(`A importação parou: ${getFormErrorMessage(failure, "falha de conexão.")} O que aparece abaixo como gravado está salvo.`);
      results.push(...toSave.filter((row) => !answered.has(row.line)).map((row) => ({ line: row.line, reference: row.data.reference, status: "error" as const, message: "Não foi enviada: a importação parou antes desta linha." })));
    }
    setOutcomes(results.sort((first, second) => first.line - second.line));
    await Promise.all([utils.product.list.invalidate(), utils.suppliers.list.invalidate(), utils.inventory.invalidate()]);
    setStep("done");
  }

  const failedRows = useMemo(() => {
    const byLine = new Map(rows.map((row) => [row.line, row]));
    return [
      ...invalid.map((row) => ({ row, reasons: row.problems })),
      ...outcomes.filter((outcome) => outcome.status === "error" && byLine.has(outcome.line)).map((outcome) => ({ row: byLine.get(outcome.line)!, reasons: [outcome.message ?? "Erro ao gravar."] })),
    ].sort((first, second) => first.row.line - second.row.line);
  }, [rows, invalid, outcomes]);
  const count = (status: Outcome["status"]) => outcomes.filter((outcome) => outcome.status === status).length;
  const failedList = useVisibleItems(failedRows, outcomes, 50);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <Dialog open onOpenChange={(open) => { if (!open && step !== "running") onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Importar catálogo por planilha</DialogTitle>
          <DialogDescription>
            {step === "start" ? "Baixe o modelo, preencha e envie. Nada é gravado antes da conferência." : step === "review" ? "Confira antes de gravar." : step === "running" ? "Importando. Mantenha esta tela aberta." : "Importação concluída."}
          </DialogDescription>
        </DialogHeader>

        {step === "start" ? (
          <div className="space-y-5">
            <section className="space-y-2 rounded-lg border border-border p-4">
              <p className="text-sm font-semibold">1. Baixe a planilha modelo</p>
              <p className="text-sm text-muted-foreground">Traz os campos do cadastro e {plural(suppliers.length, "fornecedor cadastrado", "fornecedores cadastrados")} para escolher na lista.</p>
              <Button type="button" variant="outline" onClick={() => downloadXlsx("modelo-catalogo-luminno.xlsx", catalogTemplate(access, suppliers))}>
                <Download className="mr-2 h-4 w-4" />Baixar planilha modelo
              </Button>
            </section>
            <section className="space-y-2 rounded-lg border border-border p-4">
              <Label htmlFor="import-sheet" className="font-semibold">2. Envie a planilha preenchida (.xlsx)</Label>
              <Input id="import-sheet" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => { setSheetFile(event.target.files?.[0] ?? null); setError(null); }} />
            </section>
            <section className="space-y-2 rounded-lg border border-border p-4">
              <Label htmlFor="import-photos" className="font-semibold">3. Selecione as fotos (opcional)</Label>
              <p className="text-sm text-muted-foreground">Selecione todas de uma vez. O nome de cada arquivo deve ser igual ao da coluna Foto. JPG, PNG ou WEBP.</p>
              <Input id="import-photos" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhotos(Array.from(event.target.files ?? []))} />
              {photos.length ? <p className="text-xs text-muted-foreground"><ImagePlus className="mr-1 inline h-3.5 w-3.5" />{plural(photos.length, "foto selecionada", "fotos selecionadas")}</p> : null}
            </section>
            <FormError message={error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="button" disabled={!sheetFile} onClick={() => void review()}><FileSpreadsheet className="mr-2 h-4 w-4" />Conferir planilha</Button>
            </div>
          </div>
        ) : null}

        {step === "review" ? (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="outline">{plural(rows.length, "linha", "linhas")}</Badge>
              <Badge variant="outline">{plural(valid.length - existing.length, "produto novo", "produtos novos")}</Badge>
              {existing.length ? <Badge variant="outline">{plural(existing.length, "já cadastrado", "já cadastrados")}</Badge> : null}
              {invalid.length ? <Badge variant="destructive">{plural(invalid.length, "linha com erro", "linhas com erro")}</Badge> : null}
            </div>

            {existing.length ? (
              <fieldset className="space-y-2 rounded-lg border border-border p-4">
                <legend className="px-1 text-sm font-semibold">{plural(existing.length, "referência já está no catálogo", "referências já estão no catálogo")}</legend>
                <label className="flex items-start gap-2 text-sm"><input type="radio" name="import-mode" className="mt-1" checked={mode === "skip"} onChange={() => setMode("skip")} /><span>Ignorar: mantém o produto como está.</span></label>
                <label className="flex items-start gap-2 text-sm"><input type="radio" name="import-mode" className="mt-1" checked={mode === "update"} onChange={() => setMode("update")} /><span>Atualizar: grava os dados preenchidos na planilha. Célula vazia mantém o valor atual e o estoque não muda.</span></label>
              </fieldset>
            ) : null}

            {unknown.length ? (
              <section className="space-y-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold"><AlertTriangle className="h-4 w-4 text-amber-600" />{plural(unknown.length, "fornecedor não está cadastrado", "fornecedores não estão cadastrados")}</p>
                <p className="text-sm text-muted-foreground">Decida cada um para liberar a importação.</p>
                {unknown.map((item) => {
                  const id = supplierKey(item.name);
                  const decision = decisions[id] ?? null;
                  return (
                    <div key={id} className="space-y-2 rounded-md border border-border p-3">
                      <p className="text-sm"><strong>{item.name}</strong> <span className="text-muted-foreground">({item.lines.length === 1 ? "linha" : "linhas"} {item.lines.slice(0, 12).join(", ")}{item.lines.length > 12 ? "..." : ""})</span></p>
                      <select
                        aria-label={`O que fazer com o fornecedor ${item.name}`}
                        className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                        value={decision === null ? "" : decision.action === "create" ? "__novo" : decision.to}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDecisions((current) => ({ ...current, [id]: value === "" ? null : value === "__novo" ? { action: "create" } : { action: "replace", to: value } }));
                        }}
                      >
                        <option value="">Escolha o que fazer</option>
                        <option value="__novo">Cadastrar como novo fornecedor</option>
                        {suppliers.length ? <optgroup label="Trocar por um já cadastrado">{suppliers.map((name) => <option key={name} value={name}>{name}</option>)}</optgroup> : null}
                      </select>
                    </div>
                  );
                })}
              </section>
            ) : null}

            {photoInfo.unused.length ? <p className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-sm">{plural(photoInfo.unused.length, "foto selecionada não aparece", "fotos selecionadas não aparecem")} na planilha e {photoInfo.unused.length === 1 ? "não será enviada" : "não serão enviadas"}: {photoInfo.unused.slice(0, 10).join(", ")}{photoInfo.unused.length > 10 ? "..." : ""}</p> : null}

            {attention.length ? (
              <section className="space-y-2">
                <p className="text-sm font-semibold">Linhas para conferir</p>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {list.visible.map((row) => (
                    <li key={row.line} className="space-y-1 p-3 text-sm">
                      <p className="break-words font-medium">Linha {row.line}: {row.data.reference || "(sem referência)"}{row.data.shortDescription ? ` · ${row.data.shortDescription}` : ""}</p>
                      {row.problems.map((problem) => <p key={problem} className="text-destructive">{problem}</p>)}
                      {!row.problems.length && row.existing ? <p className="text-muted-foreground">Já cadastrado como "{row.existing.shortDescription}": será {mode === "skip" ? "ignorado" : "atualizado"}.</p> : null}
                      {!row.problems.length && missingPhoto.has(row.line) ? <p className="text-amber-700 dark:text-amber-400">A foto {row.photo} não foi selecionada: {row.existing ? "mantém a foto atual" : "entra sem foto"}.</p> : null}
                      {!row.problems.length ? row.warnings.map((warning) => <p key={warning} className="text-amber-700 dark:text-amber-400">{warning}</p>) : null}
                    </li>
                  ))}
                </ul>
                <ShowMoreButton remaining={list.remaining} onClick={list.showMore} />
              </section>
            ) : <p className="text-sm text-muted-foreground">Nenhuma linha precisa de atenção.</p>}

            {invalid.length ? <p className="text-sm text-muted-foreground">As linhas com erro não serão gravadas. Ao final, você baixa essas linhas para corrigir e enviar de novo.</p> : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setStep("start")}>Voltar</Button>
              <Button type="button" disabled={undecided > 0 || !toSave.length && !existing.length} onClick={() => void run()}>
                <Upload className="mr-2 h-4 w-4" />
                {undecided ? `Decida ${plural(undecided, "fornecedor", "fornecedores")}` : toSave.length ? `Importar ${plural(toSave.length, "produto", "produtos")}` : "Concluir sem gravar"}
              </Button>
            </div>
          </div>
        ) : null}

        {step === "running" ? (
          <div className="space-y-3 py-4" role="status">
            <p className="break-words text-sm">{progress.label}...</p>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
            <p className="text-xs text-muted-foreground">{progress.done} de {progress.total}</p>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="space-y-4">
            {fatal ? <FormError message={fatal} /> : null}
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["Novos", count("created")], ["Atualizados", count("updated")], ["Ignorados", count("skipped")], ["Com erro", failedRows.length]].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-border p-3"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-xl font-semibold">{value}</dd></div>
              ))}
            </dl>
            {failedRows.length ? (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">Linhas que não entraram</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => downloadXlsx(`linhas-com-erro-${today}.xlsx`, errorSheet(access, failedRows, suppliers))}><Download className="mr-2 h-4 w-4" />Baixar para corrigir</Button>
                </div>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {failedList.visible.map(({ row, reasons }) => (
                    <li key={row.line} className="p-3 text-sm"><p className="break-words font-medium">Linha {row.line}: {row.data.reference || "(sem referência)"}</p>{reasons.map((reason) => <p key={reason} className="text-destructive">{reason}</p>)}</li>
                  ))}
                </ul>
                <ShowMoreButton remaining={failedList.remaining} onClick={failedList.showMore} />
              </section>
            ) : null}
            <div className="flex justify-end"><Button type="button" onClick={onClose}>Fechar</Button></div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
