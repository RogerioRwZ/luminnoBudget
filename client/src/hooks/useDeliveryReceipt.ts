import { trpc } from "@/lib/trpc";
import { buildReceipt, buildReceiptDocument } from "@shared/deliveryReceipt";
import { toast } from "sonner";

// Abre o comprovante em uma janela para imprimir ou salvar em PDF. A janela
// abre antes de buscar os dados: depois da espera, o navegador a bloquearia.
export function useDeliveryReceipt() {
  const utils = trpc.useUtils();
  return async (quoteId: number, deliveryId: number) => {
    const popup = window.open("", "_blank");
    if (!popup) {
      toast.error("Permita pop-ups para abrir o comprovante.");
      return;
    }
    try {
      const [lines, settings, auth] = await Promise.all([
        utils.inventory.quoteFulfillment.fetch({ quoteId }),
        utils.settings.get.fetch(),
        utils.auth.status.fetch(),
      ]);
      const receipt = buildReceipt(lines, deliveryId);
      if (!receipt) throw new Error("Retirada não encontrada.");
      popup.document.write(buildReceiptDocument({ receipt, issuedAt: new Date(), issuedBy: auth.user?.name || auth.user?.username, brand: settings }));
      popup.document.close();
      popup.focus();
      popup.print();
    } catch {
      popup.close();
      toast.error("Não foi possível montar o comprovante. Atualize a página e tente novamente.");
    }
  };
}
