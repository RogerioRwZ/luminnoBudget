import { usePermissions } from "@/hooks/usePermissions";
import { toast } from "sonner";

// Endereço do catálogo que já abre o cadastro com o código lido.
export const newProductPath = (code: string) => `/catalogo?novo=${encodeURIComponent(code)}`;

// Código lido que não está no catálogo: quem pode cadastrar recebe o atalho.
// O cadastro abre em outra aba para não perder o orçamento ou a janela
// aberta; ao voltar, a lista de produtos se atualiza sozinha.
export function useUnknownCode() {
  const { can } = usePermissions();
  return (code: string) => {
    const message = `Nenhum produto com o código ${code}.`;
    if (!can("catalog")) return toast.error(message);
    toast.error(message, {
      duration: 10_000,
      action: { label: "Cadastrar", onClick: () => window.open(newProductPath(code), "_blank", "noopener") },
    });
  };
}
