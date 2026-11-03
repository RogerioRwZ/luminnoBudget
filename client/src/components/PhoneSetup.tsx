import { Button } from "@/components/ui/button";
import { getFormErrorMessage } from "@/components/FormFeedback";
import { canInstall, isIos, isStandalone, keyToBytes, onInstallChange, promptInstall, pushSupported } from "@/lib/pwa";
import { trpc } from "@/lib/trpc";
import { BellRing, BellOff, Download, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

// Erros do navegador vêm em inglês e técnicos; traduz os comuns.
function pushErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "O navegador não permitiu os avisos. Libere as notificações deste site nas configurações do navegador e tente de novo.";
  if (name === "AbortError" || name === "NotSupportedError") return "Este navegador não conseguiu se inscrever no serviço de avisos. Tente pelo Chrome, Edge, Firefox ou Safari atualizados.";
  return getFormErrorMessage(error, "Não foi possível ativar os avisos neste aparelho.");
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

// "No celular": instalar o sistema como app e ativar os avisos neste aparelho.
export function PhoneSetup() {
  const utils = trpc.useUtils();
  const [installable, setInstallable] = useState(canInstall());
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported() && window.isSecureContext;
  const status = trpc.push.status.useQuery({ endpoint }, { enabled: supported });
  const subscribe = trpc.push.subscribe.useMutation();
  const unsubscribe = trpc.push.unsubscribe.useMutation();
  const test = trpc.push.test.useMutation();
  const active = Boolean(endpoint) && Boolean(status.data?.thisDevice);
  const needsHomeScreen = isIos() && !isStandalone();

  useEffect(() => onInstallChange(() => setInstallable(canInstall())), []);
  useEffect(() => {
    currentSubscription().then(subscription => setEndpoint(subscription?.endpoint ?? null), () => setEndpoint(null));
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Os avisos foram bloqueados. Libere as notificações deste site nas configurações do navegador.");
        return;
      }
      const registration = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const publicKey = await utils.push.publicKey.fetch();
      const subscription = (await registration.pushManager.getSubscription()) ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) }));
      const json = subscription.toJSON();
      await subscribe.mutateAsync({ endpoint: subscription.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", userAgent: navigator.userAgent });
      setEndpoint(subscription.endpoint);
      await utils.push.status.invalidate();
      toast.success("Avisos ativados neste aparelho.");
    } catch (error) {
      toast.error(pushErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const subscription = await currentSubscription();
      if (subscription) {
        await unsubscribe.mutateAsync({ endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setEndpoint(null);
      await utils.push.status.invalidate();
      toast.success("Avisos desativados neste aparelho.");
    } catch (error) {
      toast.error(getFormErrorMessage(error, "Não foi possível desativar os avisos."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-border p-3">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <Smartphone className="h-3.5 w-3.5" />
        No celular
      </p>
      <p className="text-xs text-muted-foreground">
        Receba este resumo de manhã{" "}
        {status.data?.devices ? `(${status.data.devices} ${status.data.devices === 1 ? "aparelho ativo" : "aparelhos ativos"})` : ""}
        {" "}e, se for administrador, o aviso de backup com falha.
      </p>
      {needsHomeScreen ? (
        <p className="rounded-lg bg-muted/60 p-2 text-xs">
          No iPhone, primeiro adicione o sistema à Tela de Início: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>. Abra pelo ícone e ative os avisos.
        </p>
      ) : null}
      {!supported && !needsHomeScreen ? (
        <p className="text-xs text-muted-foreground">
          {window.isSecureContext ? "Este navegador não recebe avisos." : "Os avisos precisam do endereço com HTTPS."}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {installable && !isStandalone() ? (
          <Button size="sm" variant="outline" onClick={() => promptInstall()}>
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Instalar o app
          </Button>
        ) : null}
        {supported && !needsHomeScreen ? (
          active ? (
            <>
              <Button size="sm" variant="outline" disabled={busy} onClick={disable}>
                <BellOff className="mr-1.5 h-3.5 w-3.5" />
                Desativar avisos
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(undefined, {
                    onSuccess: result => (result.sent ? toast.success("Aviso de teste enviado.") : toast.error("O aviso de teste não foi entregue. Desative e ative de novo.")),
                    onError: error => toast.error(getFormErrorMessage(error, "Não foi possível enviar o teste.")),
                  })
                }
              >
                Enviar teste
              </Button>
            </>
          ) : (
            <Button size="sm" disabled={busy} onClick={enable}>
              <BellRing className="mr-1.5 h-3.5 w-3.5" />
              Ativar avisos neste aparelho
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
