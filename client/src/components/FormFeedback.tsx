import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

/**
 * Converte erros de APIs/tRPC em uma orientação curta e acionável.
 * O detalhe original continua disponível no console para diagnóstico.
 */
export function getFormErrorMessage(
  error: unknown,
  fallback = "Não foi possível concluir esta ação. Revise os dados e tente novamente."
) {
  if (error == null) return "";
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const normalized = raw.toLocaleLowerCase("pt-BR");

  if (!raw.trim()) return fallback;
  if (
    normalized.includes("invalid credentials") ||
    normalized.includes("credenciais inválidas")
  ) {
    return "Usuário ou senha incorretos. Confira os dados e tente novamente.";
  }
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("não autenticado") ||
    normalized.includes("sessão")
  ) {
    return "Sua sessão expirou. Entre novamente para continuar.";
  }
  if (normalized.includes("forbidden") || normalized.includes("permissão")) {
    return "Você não tem permissão para realizar esta ação.";
  }
  if (normalized.includes("too many login attempts")) {
    return "Muitas tentativas de login. Aguarde alguns minutos e tente novamente.";
  }
  if (
    normalized.includes("too many") ||
    normalized.includes("rate limit") ||
    normalized.includes("muitas tentativas")
  ) {
    return "Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente novamente.";
  }
  if (
    normalized.includes("duplicate") ||
    normalized.includes("já existe") ||
    normalized.includes("unique")
  ) {
    return "Já existe um registro com estes dados. Confira as informações e tente novamente.";
  }
  if (
    normalized.includes("not found") ||
    normalized.includes("não encontrado")
  ) {
    return "O registro não foi encontrado. Atualize a página e tente novamente.";
  }
  if (
    normalized.includes("invalid") ||
    normalized.includes("inválid") ||
    normalized.includes("validation") ||
    normalized.includes("obrigat")
  ) {
    return raw.length <= 180 ? raw : fallback;
  }
  if (
    normalized.includes("network") ||
    normalized.includes("fetch") ||
    normalized.includes("failed to fetch")
  ) {
    return "Não foi possível conectar ao servidor. Verifique a conexão e tente novamente.";
  }

  return raw.length <= 180 && !/[{}[\]]/.test(raw) ? raw : fallback;
}

export function reportFormError(
  error: unknown,
  fallback?: string,
  onMessage?: (message: string) => void
) {
  const message = getFormErrorMessage(error, fallback);
  if (error && !(error instanceof Error && error.message === message)) {
    console.error("Form submission failed", error);
  }
  onMessage?.(message);
  return message;
}

type AsyncButtonProps = ComponentProps<typeof Button> & {
  pending?: boolean;
  loadingLabel?: string;
  children: ReactNode;
};

export function AsyncButton({
  pending = false,
  loadingLabel = "Processando…",
  children,
  className,
  disabled,
  ...props
}: AsyncButtonProps) {
  return (
    <Button
      {...props}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      className={cn(className)}
    >
      {pending ? <Spinner aria-hidden="true" /> : null}
      <span>{pending ? loadingLabel : children}</span>
    </Button>
  );
}

export function FormError({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
