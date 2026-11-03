import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { money } from "@/lib/format";
import { pixQrDataUrl } from "@/lib/pixQr";
import { trpc } from "@/lib/trpc";
import {
  mailtoLink,
  whatsappLink,
  type MessageEvent,
} from "@shared/messages";
import { normalizeWhatsAppPhone } from "@shared/whatsapp";
import { Copy, Download, Mail, MessageCircle, QrCode, Share2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PhoneInput } from "@/components/ContactInputs";
import { normalizePhone } from "@shared/contact";

export type DialogMessage = {
  event: MessageEvent;
  eventLabel: string;
  quoteId: number | null;
  receivableId: number | null;
  clientName: string;
  phone: string;
  email: string;
  subject: string;
  body: string;
  amount: number;
  pix: string;
};

// Mensagem pronta para revisar e enviar pelo WhatsApp ou e-mail da própria
// pessoa. O texto pode ser ajustado antes do envio.
export function MessageDialog({
  message,
  open,
  onOpenChange,
  loading = false,
  error,
}: {
  message: DialogMessage | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
  error?: string | null;
}) {
  const [body, setBody] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [qr, setQr] = useState("");
  const logSent = trpc.messages.logSent.useMutation();

  useEffect(() => {
    if (!message) return;
    setBody(message.body);
    setPhone(normalizePhone(message.phone) ?? "");
    setEmail(message.email);
    setQr("");
    if (!message.pix) return;
    // O QR fica pronto depois: se a janela fechar ou trocar de mensagem antes,
    // o resultado atrasado é descartado (não mostra o PIX de outra cobrança).
    let current = true;
    pixQrDataUrl(message.pix)
      .then(url => current && setQr(url))
      .catch(() => current && setQr(""));
    return () => {
      current = false;
    };
  }, [message]);

  // No celular, abre a tela de compartilhar do aparelho (WhatsApp incluído);
  // no computador, baixa a imagem para anexar na conversa.
  const canShareImage = typeof navigator !== "undefined" && typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([], "pix.png", { type: "image/png" })] });
  const shareQr = async () => {
    if (!message?.pix) return;
    try {
      const fileName = `pix-${message.receivableId ? `parcela-${message.receivableId}` : "orcamento"}.png`;
      const dataUrl = await pixQrDataUrl(message.pix, 640);
      if (canShareImage) {
        const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]!), character => character.charCodeAt(0));
        await navigator.share({ files: [new File([bytes], fileName, { type: "image/png" })], title: `PIX de ${money(message.amount)}` });
      } else {
        const link = document.createElement("a");
        link.href = dataUrl;
        link.download = fileName;
        document.body.append(link);
        link.click();
        link.remove();
      }
      register("copy");
    } catch (error) {
      // Cancelar a tela de compartilhar não é erro.
      if (!(error instanceof DOMException && error.name === "AbortError")) toast.error("Não foi possível preparar o QR Code.");
    }
  };
  const register = (channel: "whatsapp" | "email" | "copy") => {
    if (!message) return;
    logSent.mutate({
      event: message.event,
      channel,
      clientName: message.clientName,
      quoteId: message.quoteId,
      receivableId: message.receivableId,
    });
  };
  const copy = async (text: string, label: string, track = false) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copiado`);
      if (track) register("copy");
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  };
  const whatsappPhone = normalizeWhatsAppPhone(phone);
  const sendWhatsApp = () => {
    window.open(whatsappLink(whatsappPhone, body), "_blank", "noopener,noreferrer");
    register("whatsapp");
  };
  const sendEmail = () => {
    window.location.href = mailtoLink(email.trim(), message?.subject ?? "", body);
    register("email");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto overflow-x-hidden sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{message?.eventLabel ?? "Mensagem"}</DialogTitle>
          <DialogDescription>
            {message
              ? `Para ${message.clientName || "cliente sem nome"}. Revise o texto antes de enviar.`
              : "Preparando a mensagem…"}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="py-6 text-center text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : loading || !message ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Preparando a mensagem…
          </p>
        ) : (
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="message-phone">WhatsApp</Label>
                <PhoneInput id="message-phone" value={phone} onValueChange={setPhone} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="message-email">E-mail</Label>
                <Input
                  id="message-email"
                  type="email"
                  value={email}
                  placeholder="cliente@email.com"
                  onChange={event => setEmail(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="message-body">Mensagem</Label>
              {/* field-sizing fixo: o tamanho automático do Textarea faria o
                  código PIX (uma linha longa, sem espaços) alargar a janela. */}
              <Textarea
                id="message-body"
                className="[field-sizing:fixed]"
                rows={9}
                value={body}
                onChange={event => setBody(event.target.value)}
              />
            </div>
            {message.pix ? (
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-3 sm:flex-row sm:items-center">
                {qr ? (
                  <img
                    src={qr}
                    alt={`QR Code PIX de ${money(message.amount)}`}
                    className="h-32 w-32 shrink-0 self-center rounded-lg bg-white p-1"
                  />
                ) : (
                  <QrCode className="h-10 w-10 self-center text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1 space-y-2 text-sm">
                  <p className="font-semibold">PIX de {money(message.amount)}</p>
                  <p className="break-all rounded-md bg-background p-2 font-mono text-[11px] leading-snug">
                    {message.pix}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copy(message.pix, "PIX copia e cola")}
                  >
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                    Copiar PIX
                  </Button>
                  <Button size="sm" variant="outline" className="ml-2" onClick={shareQr}>
                    {canShareImage ? <Share2 className="mr-1.5 h-3.5 w-3.5" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
                    {canShareImage ? "Enviar QR Code" : "Baixar QR Code"}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    O WhatsApp recebe o texto com o PIX copia e cola. Para mandar o QR Code, {canShareImage ? "envie a imagem" : "baixe a imagem e anexe na conversa"}.
                  </p>
                </div>
              </div>
            ) : message.event === "payment_due" || message.event === "payment_overdue" ? (
              <p className="rounded-xl border border-amber-400/50 bg-amber-500/10 p-3 text-xs">
                Esta cobrança vai sem PIX. Confira a chave, o favorecido e a cidade do PIX em Configurações.
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => copy(body, "Texto", true)}>
                <Copy className="mr-1.5 h-4 w-4" />
                Copiar texto
              </Button>
              <Button
                variant="outline"
                disabled={!email.trim()}
                title={email.trim() ? undefined : "Informe um e-mail"}
                onClick={sendEmail}
              >
                <Mail className="mr-1.5 h-4 w-4" />
                E-mail
              </Button>
              <Button
                disabled={!whatsappPhone}
                title={whatsappPhone ? undefined : "Informe um telefone"}
                onClick={sendWhatsApp}
              >
                <MessageCircle className="mr-1.5 h-4 w-4" />
                WhatsApp
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
