import { trpc } from "@/lib/trpc";
import { createQuotePdfBlob, fromPdfSnapshot } from "@/lib/quotePdf";
import { useState } from "react";
import { toast } from "sonner";

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export type PdfHistoryDownloadEntry = { id: number; fileName: string; rebuild: boolean; downloadUrl: string | null };

// Baixar do histórico: os PDFs novos são montados no navegador a partir dos
// dados guardados; os gerados antes desta versão ainda vêm do arquivo.
export function usePdfHistoryDownload() {
  const utils = trpc.useUtils();
  const [busyId, setBusyId] = useState<number | null>(null);
  const download = async (entry: PdfHistoryDownloadEntry) => {
    if (!entry.rebuild && entry.downloadUrl) {
      const link = document.createElement("a");
      link.href = entry.downloadUrl;
      link.download = entry.fileName;
      document.body.append(link);
      link.click();
      link.remove();
      return;
    }
    setBusyId(entry.id);
    try {
      const { snapshot, fileName } = await utils.quote.pdfSnapshot.fetch({ id: entry.id });
      const { blob, failedImageCount } = await createQuotePdfBlob(fromPdfSnapshot(snapshot));
      saveBlob(blob, fileName);
      if (failedImageCount > 0) toast.warning("Alguma imagem (logotipo ou foto) não está mais disponível e ficou de fora deste PDF.");
    } catch {
      toast.error("Não foi possível montar este PDF. Tente novamente.");
    } finally {
      setBusyId(null);
    }
  };
  return { download, busyId };
}
