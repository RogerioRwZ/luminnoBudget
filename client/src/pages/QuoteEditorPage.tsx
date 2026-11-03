import { Badge } from "@/components/ui/badge";
import {
  AsyncButton,
  FormError,
  getFormErrorMessage,
} from "@/components/FormFeedback";
import { DraftAutosaveStatus } from "@/components/DraftAutosaveStatus";
import {
  useDraftAutosave,
  type DraftAutosaveStatus as AutosaveStatus,
} from "@/hooks/useDraftAutosave";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QuotePdfHistoryPanel } from "@/components/QuotePdfHistoryPanel";
import { QuoteFinancePanel } from "@/components/QuoteFinancePanel";
import { AfterSalesQuotePanel } from "@/components/AfterSalesQuotePanel";
import { usePermissions } from "@/hooks/usePermissions";
import { QuoteMarginPanel, StockShortageHint } from "@/components/QuoteInsights";
import { canSeeCost } from "@shared/permissions";
import { LOST_REASONS, LOST_REASON_LABELS, type LostReason } from "@shared/followUp";
import { DEFAULT_ENTRY_OFFER, describeEntryOffer, describePart, parseEntryOffer, parsePaymentPlan, type EntryOffer, type PaymentPlan } from "@shared/paymentPlan";
import { PaymentPlanDialog } from "@/components/PaymentPlanDialog";
import { Switch } from "@/components/ui/switch";
import { parseAttributes, variantLabel } from "@shared/variants";
import { findProductByScan, matchesProductSearch, saleReference } from "@shared/productCodes";
import { ScanButton } from "@/components/CameraBarcodeScanner";
import { useUnknownCode } from "@/hooks/useUnknownCode";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDateInput, money } from "@/lib/format";
import { createQuotePdfBlob, toPdfSnapshot, type QuotePdfInput } from "@/lib/quotePdf";
import { saveBlob } from "@/lib/pdfHistoryDownload";
import { quotePdfFileName } from "@shared/quoteFileName";
import { trpc } from "@/lib/trpc";
import { calculateQuote } from "@shared/quote";
import { QUOTE_STATUS_LABELS, type QuoteStatus } from "@shared/quoteStatus";
import {
  duplicateArrayItem,
  duplicateDraftRoom,
  moveArrayItem,
  moveDraftItem,
  moveDraftRoom,
  removeArrayItem,
  removeDraftRoom,
} from "@shared/quoteDraft";
import { openPickingPrintDocument } from "@shared/pickingPrint";
import { buildWhatsAppProposal } from "@shared/whatsapp";
import { validateQuoteDraft } from "@shared/formValidation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MoneyInput } from "@/components/MoneyInput";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Calculator,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ClipboardList,
  Copy,
  Eye,
  FileText,
  Loader2,
  PackagePlus,
  Plus,
  Printer,
  ScanBarcode,
  ScanLine,
  CalendarPlus,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useRoute } from "wouter";

type DraftItem = {
  productId?: number | null;
  code: string;
  shortDescription: string;
  imageUrl?: string | null;
  unit: string;
  quantity: number;
  unitPrice: number;
};
type DraftRoom = { name: string; items: DraftItem[] };
type QuoteDraft = {
  id: number;
  quoteNumber: number;
  clientId: number | null;
  clientName: string;
  professional: string;
  document: string;
  stateRegistration: string;
  phone: string;
  address: string;
  status: "draft" | "open" | "approved" | "lost";
  issueDate: Date;
  validUntil: Date | null;
  discountMode: "percentage" | "fixed";
  discountValue: number;
  shipping: number;
  pixDiscountMode: "percentage" | "fixed";
  pixDiscountValue: number;
  installments: number;
  paymentPlan: PaymentPlan | null;
  entryOffer: EntryOffer | null;
  notes: string;
  followUpAt: Date | null;
  lostReason: LostReason | null;
  lostNotes: string;
  rooms: DraftRoom[];
};
type QuoteRecord = {
  id: number;
  quoteNumber: number;
  clientId: number | null;
  clientName: string;
  professional: string;
  document: string | null;
  stateRegistration: string | null;
  phone: string | null;
  address: string | null;
  status: "draft" | "open" | "approved" | "lost";
  discountMode: "percentage" | "fixed";
  pixDiscountMode: "percentage" | "fixed";
  installments: number;
  paymentPlan?: string | null;
  entryOffer?: string | null;
  notes: string | null;
  followUpAt?: Date | string | null;
  lostReason?: LostReason | null;
  lostNotes?: string | null;
  issueDate: Date | string;
  validUntil: Date | string | null;
  discountValue: number | string;
  shipping: number | string;
  pixDiscountValue: number | string;
  rooms: Array<{
    name: string;
    items: Array<
      Omit<DraftItem, "quantity" | "unitPrice"> & {
        quantity: number | string;
        unitPrice: number | string;
      }
    >;
  }>;
};
type StoreSettings = {
  companyName: string;
  tradingName: string;
  logoUrl: string | null;
  document: string | null;
  address: string | null;
  phone: string | null;
  pixKey: string | null;
  pixRecipient: string | null;
  maxDiscountPercent?: string | number;
  minMarginPercent?: string | number;
};

const blankItem = (): DraftItem => ({
  code: "",
  shortDescription: "Novo item",
  unit: "UN",
  quantity: 1,
  unitPrice: 0,
});
const escapePrint = (value: string | number | null | undefined) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    character =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        character
      ]!
  );

function fromQuote(quote: QuoteRecord): QuoteDraft {
  return {
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    clientId: quote.clientId,
    clientName: quote.clientName,
    professional: quote.professional,
    document: quote.document ?? "",
    stateRegistration: quote.stateRegistration ?? "",
    phone: quote.phone ?? "",
    address: quote.address ?? "",
    status: quote.status,
    issueDate: new Date(quote.issueDate),
    validUntil: quote.validUntil ? new Date(quote.validUntil) : null,
    discountMode: quote.discountMode,
    discountValue: Number(quote.discountValue),
    shipping: Number(quote.shipping),
    pixDiscountMode: quote.pixDiscountMode,
    pixDiscountValue: Number(quote.pixDiscountValue),
    installments: quote.installments,
    paymentPlan: parsePaymentPlan(quote.paymentPlan),
    entryOffer: parseEntryOffer(quote.entryOffer),
    notes: quote.notes ?? "",
    followUpAt: quote.followUpAt ? new Date(quote.followUpAt) : null,
    lostReason: quote.lostReason ?? null,
    lostNotes: quote.lostNotes ?? "",
    rooms: quote.rooms.map(room => ({
      name: room.name,
      items: room.items.map(item => ({
        productId: item.productId,
        code: item.code,
        shortDescription: item.shortDescription,
        imageUrl: item.imageUrl,
        unit: item.unit,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
      })),
    })),
  };
}


export default function QuoteEditorPage() {
  const [isNewRoute] = useRoute("/orcamentos/novo");
  const [, params] = useRoute("/orcamentos/:id");
  const [, setLocation] = useLocation();
  const quoteId = Number(params?.id);
  const utils = trpc.useUtils();
  const serverFingerprint = useRef("");
  const pendingSaveFingerprint = useRef("");
  const [serverAutosaveStatus, setServerAutosaveStatus] =
    useState<AutosaveStatus>("idle");
  const quoteQuery = trpc.quote.get.useQuery(
    { id: quoteId },
    { enabled: Number.isFinite(quoteId) && quoteId > 0 }
  );
  const { data: products = [] } = trpc.product.list.useQuery();
  const { data: customers = [] } = trpc.customers.list.useQuery();
  const settingsQuery = trpc.settings.get.useQuery();
  const { can, role } = usePermissions();
  const showCost = canSeeCost(role);
  const { data: availabilityRows } = trpc.product.availability.useQuery(undefined, { staleTime: 30_000 });
  const availability = useMemo(() => new Map((availabilityRows ?? []).map(row => [row.productId, row.available])), [availabilityRows]);
  const [lossDialog, setLossDialog] = useState<{ reason: LostReason; notes: string } | null>(null);
  const [planDialog, setPlanDialog] = useState(false);
  const settings = settingsQuery.data as StoreSettings | undefined;
  const pickingQuery = trpc.inventory.picking.useQuery(
    { quoteId: Number.isFinite(quoteId) && quoteId > 0 ? quoteId : 1 },
    { enabled: false }
  );
  const createNew = trpc.quote.create.useMutation({
    onSuccess: quote => {
      if (quote) {
        setEditorError("");
        setDraft(fromQuote(quote as QuoteRecord));
        setLocation(`/orcamentos/${quote.id}`);
        toast.success("Novo orçamento criado");
      }
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível criar o orçamento. Volte à lista e tente novamente."
      );
      setEditorError(message);
      toast.error(message);
      setLocation("/orcamentos");
    },
  });
  const savePdf = trpc.quote.savePdf.useMutation({
    onSuccess: () => {
      setEditorError("");
      utils.quote.pdfHistory.invalidate();
      utils.quote.pdfHistoryAll.invalidate();
      toast.success("PDF baixado e registrado no histórico.");
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível salvar o PDF no histórico. Gere o documento novamente."
      );
      setEditorError(message);
      toast.error(message);
    },
  });
  const save = trpc.quote.save.useMutation({
    onSuccess: quote => {
      if (quote) {
        const savedDraft = fromQuote(quote);
        serverFingerprint.current = JSON.stringify(savedDraft);
        setServerAutosaveStatus("saved");
        setEditorError("");
        // Only replace the local draft with the server response if nothing
        // changed locally while the request was in flight. Otherwise this
        // would overwrite fresh keystrokes (e.g. renaming an ambiente) with
        // the older value that was actually submitted, making the field
        // appear to "revert" while the person is still typing.
        setDraft(current => {
          if (!current) return current;
          if (JSON.stringify(current) !== pendingSaveFingerprint.current) {
            return current;
          }
          return savedDraft;
        });
        utils.quote.list.invalidate();
        utils.dashboard.invalidate();
        toast.success("Orçamento salvo");
      }
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível salvar o orçamento. Confira os campos e tente novamente."
      );
      setServerAutosaveStatus("error");
      setEditorError(message);
      toast.error(message);
    },
  });
  const remove = trpc.quote.delete.useMutation({
    onSuccess: () => {
      setEditorError("");
      utils.quote.list.invalidate();
      utils.dashboard.invalidate();
      setLocation("/orcamentos");
      toast.success("Orçamento excluído");
    },
    onError: error => {
      const message = getFormErrorMessage(
        error,
        "Não foi possível excluir o orçamento. Atualize a página e tente novamente."
      );
      setEditorError(message);
      toast.error(message);
    },
  });
  const [editorError, setEditorError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState<QuoteDraft | null>(null);
  const serverDraftFingerprint = useMemo(
    () => (quoteQuery.data ? JSON.stringify(fromQuote(quoteQuery.data as QuoteRecord)) : null),
    [quoteQuery.data]
  );
  const localDraft = useDraftAutosave<QuoteDraft | null>(
    `quote-${draft?.id ?? "new"}`,
    draft,
    { enabled: Boolean(draft), pristineFingerprint: serverDraftFingerprint }
  );
  const [searches, setSearches] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreparingPrint, setIsPreparingPrint] = useState(false);
  const focusedFieldIndex = useRef<number | null>(null);
  useEffect(() => {
    if (quoteQuery.data) {
      const loadedDraft = fromQuote(quoteQuery.data as QuoteRecord);
      serverFingerprint.current = JSON.stringify(loadedDraft);
      setServerAutosaveStatus("saved");
      setDraft(loadedDraft);
    }
  }, [quoteQuery.data]);
  useEffect(() => {
    if (!draft || quoteQuery.isLoading || createNew.isPending || save.isPending)
      return;
    const fingerprint = JSON.stringify(draft);
    if (!serverFingerprint.current) {
      serverFingerprint.current = fingerprint;
      return;
    }
    if (fingerprint === serverFingerprint.current) return;
    setServerAutosaveStatus("waiting");
    const timer = window.setTimeout(() => {
      setServerAutosaveStatus("saving");
      pendingSaveFingerprint.current = JSON.stringify(draft);
      save.mutate(draft);
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [createNew.isPending, draft, quoteQuery.isLoading, save.isPending]);
  useEffect(() => {
    if (isNewRoute && !draft && !createNew.isPending) createNew.mutate();
  }, [isNewRoute, draft, createNew]);
  const summary = useMemo(
    () =>
      draft
        ? calculateQuote({
            rooms: draft.rooms,
            discountMode: draft.discountMode,
            discountValue: draft.discountValue,
            shipping: draft.shipping,
            pixDiscountMode: draft.pixDiscountMode,
            pixDiscountValue: draft.pixDiscountValue,
            installments: draft.installments,
          })
        : null,
    [draft]
  );
  const activeProducts = useMemo(
    () => products.filter(product => product.active),
    [products]
  );
  // Variações do mesmo modelo aparecem juntas na busca.
  const familyMembers = useMemo(() => {
    const families = new Map<number, typeof activeProducts>();
    activeProducts.forEach(product => {
      const rootId = product.parentId ?? product.id;
      families.set(rootId, [...(families.get(rootId) ?? []), product]);
    });
    // Modelo com variações: o principal sem cor/temperatura/potência é só o
    // modelo; na venda valem as variações, cada uma com sua referência.
    families.forEach((members, rootId) => {
      if (members.length > 1) {
        const root = members.find(member => member.id === rootId);
        if (root && !variantLabel(parseAttributes(root.attributes))) families.set(rootId, members.filter(member => member !== root));
      }
    });
    families.forEach(members =>
      members.sort((first, second) =>
        Number(Boolean(first.parentId)) - Number(Boolean(second.parentId)) ||
        first.shortDescription.localeCompare(second.shortDescription, "pt-BR", { numeric: true })
      )
    );
    return families;
  }, [activeProducts]);
  const [openFamily, setOpenFamily] = useState<string | null>(null);
  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  // Falta de estoque só interessa enquanto a proposta está em negociação:
  // aprovada, ela já tem reserva (e o restante aparece em Compras).
  const neededByProduct = useMemo(() => {
    const totals = new Map<number, number>();
    if (draft && (draft.status === "draft" || draft.status === "open")) {
      draft.rooms.forEach(room => room.items.forEach(item => {
        if (item.productId) totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
      }));
    }
    return totals;
  }, [draft]);
  const marginItems = useMemo(
    () => (draft?.rooms ?? []).flatMap(room => room.items.map(item => {
      const cost = item.productId ? (productById.get(item.productId) as { costPrice?: string | null } | undefined)?.costPrice : null;
      return { quantity: item.quantity, unitPrice: item.unitPrice, unitCost: cost === null || cost === undefined ? null : Number(cost) };
    })),
    [draft, productById]
  );
  // Deslocamento (offset) do item global de cada ambiente, para numerar os
  // campos de item de forma contínua entre ambientes (item 1, 2, 3...),
  // independentemente de quantos ambientes existam.
  const itemGlobalOffsets = useMemo(() => {
    let running = 0;
    return (draft?.rooms ?? []).map(room => {
      const start = running;
      running += room.items.length;
      return start;
    });
  }, [draft]);
  const preserveFocusedField = () => {
    const active = document.activeElement;
    if (
      !(
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement
      )
    )
      return;
    const fields = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input, textarea"
      )
    );
    const index = fields.indexOf(active);
    focusedFieldIndex.current = index >= 0 ? index : null;
  };
  useLayoutEffect(() => {
    const index = focusedFieldIndex.current;
    if (index === null) return;
    const field = document.querySelectorAll<
      HTMLInputElement | HTMLTextAreaElement
    >("input, textarea")[index];
    field?.focus();
    focusedFieldIndex.current = null;
  }, [draft]);
  const changeDraft = (change: Partial<QuoteDraft>) => {
    preserveFocusedField();
    setDraft(current => (current ? { ...current, ...change } : current));
  };
  const updateRoom = (roomIndex: number, change: Partial<DraftRoom>) => {
    preserveFocusedField();
    setDraft(current =>
      current
        ? {
            ...current,
            rooms: current.rooms.map((room, index) =>
              index === roomIndex ? { ...room, ...change } : room
            ),
          }
        : current
    );
  };
  const updateItem = (
    roomIndex: number,
    itemIndex: number,
    change: Partial<DraftItem>
  ) => {
    preserveFocusedField();
    setDraft(current =>
      current
        ? {
            ...current,
            rooms: current.rooms.map((room, currentRoom) =>
              currentRoom === roomIndex
                ? {
                    ...room,
                    items: room.items.map((item, currentItem) =>
                      currentItem === itemIndex ? { ...item, ...change } : item
                    ),
                  }
                : room
            ),
          }
        : current
    );
  };
  // Mantém o estado de busca de produtos (por ambiente) alinhado por posição
  // com `draft.rooms`, para que reordenar, duplicar, remover ou adicionar um
  // ambiente não deixe um texto de busca "grudado" na posição errada.
  const padSearches = (list: string[], length: number) =>
    list.length >= length ? list : [...list, ...Array(length - list.length).fill("")];
  const setSearchAt = (index: number, value: string) =>
    setSearches(current => {
      const next = padSearches(current, index + 1).slice();
      next[index] = value;
      return next;
    });
  const unknownCode = useUnknownCode();
  // Código lido (câmera ou leitor USB) que bate com um produto: entra direto.
  const addScanned = (roomIndex: number, value: string) => {
    const product = findProductByScan(activeProducts, value);
    if (!product) return false;
    addProduct(roomIndex, product.id);
    toast.success(`${product.shortDescription} adicionado.`);
    return true;
  };
  const addProduct = (roomIndex: number, productId: number) => {
    const product = products.find(entry => entry.id === productId);
    if (!product) return;
    setDraft(current =>
      current
        ? {
            ...current,
            rooms: current.rooms.map((room, index) =>
              index === roomIndex
                ? {
                    ...room,
                    items: [
                      ...room.items,
                      {
                        productId: product.id,
                        code: saleReference(product),
                        shortDescription: product.shortDescription,
                        imageUrl: product.imageUrl,
                        unit: product.unit,
                        quantity: 1,
                        unitPrice: Number(product.unitPrice),
                      },
                    ],
                  }
                : room
            ),
          }
        : current
    );
    setSearchAt(roomIndex, "");
  };
  const moveRoom = (index: number, direction: -1 | 1) => {
    setDraft(current =>
      current
        ? { ...current, rooms: moveDraftRoom(current.rooms, index, direction) }
        : current
    );
    setSearches(current =>
      moveArrayItem(padSearches(current, draft?.rooms.length ?? current.length), index, direction)
    );
  };
  const moveItem = (roomIndex: number, fromIndex: number, toIndex: number) =>
    setDraft(current =>
      current
        ? {
            ...current,
            rooms: current.rooms.map((room, index) =>
              index === roomIndex
                ? {
                    ...room,
                    items: moveDraftItem(room.items, fromIndex, toIndex),
                  }
                : room
            ),
          }
        : current
    );
  const duplicateRoom = (index: number) => {
    setDraft(current =>
      current
        ? { ...current, rooms: duplicateDraftRoom(current.rooms, index) }
        : current
    );
    setSearches(current =>
      duplicateArrayItem(padSearches(current, draft?.rooms.length ?? current.length), index, "")
    );
  };
  const removeRoom = (index: number) => {
    setDraft(current =>
      current
        ? { ...current, rooms: removeDraftRoom(current.rooms, index) }
        : current
    );
    setSearches(current =>
      removeArrayItem(padSearches(current, draft?.rooms.length ?? current.length), index)
    );
  };
  const addRoom = () => {
    setDraft(current =>
      current
        ? {
            ...current,
            rooms: [...current.rooms, { name: "NOVO AMBIENTE", items: [] }],
          }
        : current
    );
    setSearches(current => [...padSearches(current, draft?.rooms.length ?? current.length), ""]);
  };
  const selectCustomer = (id: string) => {
    const customer = customers.find(entry => entry.id === Number(id));
    if (!customer) return;
    changeDraft({
      clientId: customer.id,
      clientName: customer.name,
      professional: customer.professional,
      document: customer.document ?? "",
      stateRegistration: customer.stateRegistration ?? "",
      phone: customer.phone ?? "",
      address: customer.address ?? "",
    });
  };
  const copyWhatsApp = async () => {
    if (!draft || !summary) return;
    const text = buildWhatsAppProposal({
      brand: settings?.tradingName || "Luminno",
      quoteNumber: draft.quoteNumber,
      clientName: draft.clientName,
      rooms: draft.rooms,
      installments: draft.installments,
      entryOffer: draft.entryOffer,
      notes: draft.notes,
      summary,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Proposta copiada para o WhatsApp");
    } catch {
      toast.error("Não foi possível copiar o texto");
    }
  };
  const exportPicking = async () => {
    const result = await pickingQuery.refetch();
    if (result.error) {
      const message = getFormErrorMessage(
        result.error,
        "Não foi possível montar a lista de separação. Atualize o orçamento e tente novamente."
      );
      setEditorError(message);
      toast.error(message);
      return;
    }
    const data = result.data;
    if (!data) {
      const message =
        "Não foi possível montar a lista de separação. Atualize o orçamento e tente novamente.";
      setEditorError(message);
      toast.error(message);
      return;
    }
    const opened = openPickingPrintDocument(
      {
        quote: data.quote,
        items: data.items,
        issuedAt: new Date().toLocaleString("pt-BR"),
        brand: settings,
      },
      () => window.open("", "_blank", "width=1000,height=800")
    );
    if (!opened) toast.error("Permita pop-ups para exportar a separação");
  };
  // Regenera a pré-visualização (com pequena espera) enquanto ela está aberta.
  // A URL anterior só é liberada depois que a nova está pronta, para a
  // pré-visualização não piscar em branco a cada edição.
  useEffect(() => {
    if (!preview || !draft || !summary) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { blob } = await createQuotePdfBlob({ ...draft, summary, settings });
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setPreviewUrl(previous => {
          if (previous) URL.revokeObjectURL(previous);
          return url;
        });
      } catch {
        if (!cancelled) toast.error("Não foi possível gerar a pré-visualização do PDF.");
      }
    }, 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [preview, draft, summary, settings]);
  useEffect(() => {
    if (preview) return;
    setPreviewUrl(previous => {
      if (previous) URL.revokeObjectURL(previous);
      return null;
    });
  }, [preview]);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const generatePdfHistory = async () => {
    if (!draft || !summary) return;
    const validation = validateQuoteDraft(draft);
    if (validation) return toast.error(validation);
    setIsGeneratingPdf(true);
    try {
      const input = { ...pdfInput(), generatedAt: new Date() };
      const { blob, failedImageCount } = await createQuotePdfBlob(input);
      if (failedImageCount > 0) {
        toast.warning(
          failedImageCount === 1
            ? "1 imagem (logotipo ou foto de produto) não pôde ser incluída no PDF. O documento foi gerado normalmente sem ela."
            : `${failedImageCount} imagens (logotipo e/ou fotos de produto) não puderam ser incluídas no PDF. O documento foi gerado normalmente sem elas.`
        );
      }
      // O arquivo vai direto para quem gerou; o servidor guarda só os dados.
      saveBlob(blob, quotePdfFileName(draft));
      savePdf.mutate({ quoteId: draft.id, snapshot: JSON.stringify(toPdfSnapshot(input)), fileSize: blob.size, clientName: draft.clientName, professional: draft.professional });
    } catch {
      toast.error("Não foi possível gerar o PDF. Tente novamente.");
    } finally {
      setIsGeneratingPdf(false);
    }
  };
  // Pré-visualizar, imprimir e salvar usam o mesmo PDF: o cliente recebe
  // exatamente o documento que a loja viu na tela.
  const pdfInput = (): QuotePdfInput => ({ ...draft!, summary: summary!, settings });
  const printA4 = async () => {
    if (!draft || !summary) return;
    setIsPreparingPrint(true);
    try {
      const { blob } = await createQuotePdfBlob(pdfInput());
      const url = URL.createObjectURL(blob);
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
      frame.src = url;
      frame.onload = () => {
        try {
          frame.contentWindow?.focus();
          frame.contentWindow?.print();
        } catch {
          window.open(url, "_blank", "noopener");
        }
        window.setTimeout(() => {
          frame.remove();
          URL.revokeObjectURL(url);
        }, 60_000);
      };
      document.body.appendChild(frame);
    } catch {
      toast.error("Não foi possível preparar a impressão. Tente novamente.");
    } finally {
      setIsPreparingPrint(false);
    }
  };
  if (quoteQuery.isLoading || !draft || !summary)
    return (
      <div className="grid min-h-[420px] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  return (
    <div className="quote-editor mx-auto max-w-[1500px] space-y-6">
      {localDraft.hasRecovery ? (
        <div className="no-print flex flex-col gap-3 rounded-xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Rascunho local encontrado</p>
            <p className="text-xs text-muted-foreground">
              Há alterações salvas neste dispositivo em{" "}
              {new Date(localDraft.recovery!.savedAt).toLocaleString("pt-BR")}.
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={localDraft.discard}>
              Descartar
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const restored = localDraft.restore();
                if (restored) setDraft(restored);
              }}
            >
              Recuperar rascunho
            </Button>
          </div>
        </div>
      ) : null}
      {editorError ? (
        <FormError className="no-print" message={editorError} />
      ) : null}
      {quoteQuery.data?.status === "approved" ? (
        <div className="no-print flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-emerald-900 dark:text-emerald-100">
            <span className="font-semibold">Orçamento aprovado.</span> Dados do
            cliente, datas e observações podem ser editados; itens, valores e
            condições ficam travados enquanto houver reserva de estoque. Para
            alterá-los, mude o status para Em aberto.
          </p>
          <div className="flex flex-wrap gap-2">
            {can("stock") ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocation(`/estoque/conferencia/${draft.id}`)}
              >
                <ScanBarcode className="mr-2 h-4 w-4" />
                Conferir separação
              </Button>
            ) : null}
            {can("agenda") ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLocation(`/agenda?orcamento=${draft.id}`)}
              >
                <CalendarPlus className="mr-2 h-4 w-4" />
                Agendar
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {isPreparingPrint ? (
        <div
          className="no-print fixed inset-0 z-[100] grid place-items-center bg-background/80 p-4 backdrop-blur-sm"
          role="status"
          aria-live="polite"
          aria-label="Preparando documento para PDF"
        >
          <div className="flex max-w-sm items-center gap-4 rounded-2xl border border-border bg-card p-5 shadow-xl">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </span>
            <div>
              <p className="font-display text-base font-bold">
                Preparando documento
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Aguarde enquanto imagens e dados são organizados para impressão
                em PDF.
              </p>
            </div>
          </div>
        </div>
      ) : null}
      <div className="no-print flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <button
            className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
            onClick={() => setLocation("/orcamentos")}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para orçamentos
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <p className="eyebrow">Proposta comercial</p>
              <h2 className="page-title">Orçamento #{draft.quoteNumber}</h2>
            </div>
            <Badge variant="secondary" className="bg-primary/10 text-primary">
              {QUOTE_STATUS_LABELS[draft.status]}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DraftAutosaveStatus status={serverAutosaveStatus} />
          <Button variant="outline" onClick={copyWhatsApp}>
            <Clipboard className="mr-2 h-4 w-4" />
            Copiar WhatsApp
          </Button>
          <AsyncButton
            variant="outline"
            onClick={exportPicking}
            pending={pickingQuery.isFetching}
            loadingLabel="Gerando separação…"
          >
            <ClipboardList className="mr-2 h-4 w-4" />
            Separação
          </AsyncButton>
          <Button
            variant="outline"
            onClick={() => setPreview(current => !current)}
            disabled={isPreparingPrint}
          >
            <Eye className="mr-2 h-4 w-4" />
            {preview ? "Ocultar PDF" : "Pré-visualizar PDF"}
          </Button>
          <Button
            variant="outline"
            onClick={printA4}
            disabled={isPreparingPrint}
          >
            <Printer className="mr-2 h-4 w-4" />
            {isPreparingPrint ? "Preparando PDF…" : "Imprimir"}
          </Button>
          <Button
            variant="outline"
            onClick={generatePdfHistory}
            disabled={savePdf.isPending || isPreparingPrint || isGeneratingPdf}
            title="Gera o PDF e guarda uma cópia no histórico do orçamento"
          >
            <FileText className="mr-2 h-4 w-4" />
            {savePdf.isPending || isGeneratingPdf ? "Gerando PDF…" : "Gerar PDF"}
          </Button>
          <Button
            variant="outline"
            onClick={() => setLocation(`/operacao?orcamento=${draft.id}`)}
            title="Versões, mensagens ao cliente, comentários internos e restauração"
          >
            <ScanLine className="mr-2 h-4 w-4" />
            Ferramentas
          </Button>
          <AsyncButton
            onClick={() => {
              const validation = validateQuoteDraft(draft);
              if (validation) {
                setEditorError(validation);
                toast.error(validation);
                return;
              }
              setEditorError("");
              setServerAutosaveStatus("saving");
              pendingSaveFingerprint.current = JSON.stringify(draft);
              save.mutate(draft);
            }}
            pending={save.isPending}
            loadingLabel="Salvando…"
            disabled={isPreparingPrint}
          >
            <Save className="mr-2 h-4 w-4" />
            Salvar
          </AsyncButton>
        </div>
      </div>
      <div className="no-print grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="font-display text-lg">
                Dados da proposta
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 pt-5 md:grid-cols-3">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(status: QuoteDraft["status"]) =>
                    // "Não aprovado" pede o motivo e "Aprovado", a forma de
                    // pagamento, antes de mudar o status.
                    status === "lost" && draft.status !== "lost"
                      ? setLossDialog({ reason: draft.lostReason ?? "price", notes: draft.lostNotes })
                      : status === "approved" && draft.status !== "approved"
                        ? setPlanDialog(true)
                        : changeDraft({ status, ...(status !== "approved" ? { paymentPlan: null } : {}) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map(status => (
                      <SelectItem key={status} value={status}>
                        {QUOTE_STATUS_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-issue-date">Emissão</Label>
                <Input
                  id="quote-issue-date"
                  type="date"
                  value={formatDateInput(draft.issueDate)}
                  onChange={e => {
                    if (e.target.value)
                      changeDraft({
                        issueDate: new Date(`${e.target.value}T12:00:00`),
                      });
                  }}
                />
              </div>
              {draft.status === "open" || draft.status === "draft" ? (
                <div className="space-y-2 md:col-span-3">
                  <Label htmlFor="quote-follow-up">Próximo retorno ao cliente</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="quote-follow-up"
                      type="date"
                      className="w-auto"
                      value={formatDateInput(draft.followUpAt)}
                      onChange={e =>
                        changeDraft({
                          followUpAt: e.target.value
                            ? new Date(`${e.target.value}T09:00:00`)
                            : null,
                        })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {draft.followUpAt
                        ? "Aparece na Visão geral no dia marcado."
                        : draft.status === "open"
                          ? "Sem retorno agendado."
                          : "Ao mudar para Em aberto, o retorno é agendado sozinho."}
                    </p>
                  </div>
                </div>
              ) : null}
              {draft.status === "lost" ? (
                <div className="space-y-2 md:col-span-3">
                  <Label htmlFor="quote-lost-reason">Motivo de não aprovação</Label>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[220px_minmax(0,1fr)]">
                    <select
                      id="quote-lost-reason"
                      className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      value={draft.lostReason ?? ""}
                      onChange={e => changeDraft({ lostReason: (e.target.value || null) as LostReason | null })}
                    >
                      <option value="">Não informado</option>
                      {LOST_REASONS.map(reason => (
                        <option key={reason} value={reason}>{LOST_REASON_LABELS[reason]}</option>
                      ))}
                    </select>
                    <Input
                      aria-label="Detalhe do motivo"
                      value={draft.lostNotes}
                      maxLength={500}
                      placeholder="Detalhe (opcional), ex.: concorrente cobrou 12% menos"
                      onChange={e => changeDraft({ lostNotes: e.target.value })}
                    />
                  </div>
                </div>
              ) : null}
              <div className="space-y-2">
                <Label htmlFor="quote-valid-until">Validade</Label>
                <Input
                  id="quote-valid-until"
                  type="date"
                  value={formatDateInput(draft.validUntil)}
                  onChange={e =>
                    changeDraft({
                      validUntil: e.target.value
                        ? new Date(`${e.target.value}T12:00:00`)
                        : null,
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b border-border pb-4">
              <CardTitle className="font-display text-lg">Cliente</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 pt-5 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label>Selecionar cliente cadastrado</Label>
                <Select
                  value={draft.clientId ? String(draft.clientId) : "manual"}
                  onValueChange={value =>
                    value !== "manual" && selectCustomer(value)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Buscar cliente cadastrado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Preenchimento manual</SelectItem>
                    {customers.map(customer => (
                      <SelectItem key={customer.id} value={String(customer.id)}>
                        {customer.professional ? `${customer.name} — ${customer.professional}` : customer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-client-name">Nome do cliente</Label>
                <Input
                  id="quote-client-name"
                  value={draft.clientName}
                  onChange={e =>
                    changeDraft({ clientName: e.target.value, clientId: null })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-professional">
                  Profissional responsável (opcional)
                </Label>
                <Input
                  id="quote-professional"
                  value={draft.professional}
                  onChange={e =>
                    changeDraft({
                      professional: e.target.value,
                      clientId: null,
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-document">CPF/CNPJ</Label>
                <Input
                  id="quote-document"
                  value={draft.document}
                  onChange={e => changeDraft({ document: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="quote-phone">Telefone</Label>
                <Input
                  id="quote-phone"
                  value={draft.phone}
                  onChange={e => changeDraft({ phone: e.target.value })}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="quote-address">Endereço</Label>
                <Input
                  id="quote-address"
                  value={draft.address}
                  onChange={e => changeDraft({ address: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>
          <div className="space-y-5">
            {draft.rooms.map((room, roomIndex) => {
              const query = searches[roomIndex] ?? "";
              const matches = query.trim()
                ? Array.from(
                    new Set(
                      activeProducts
                        .filter(product => matchesProductSearch(product, query))
                        .map(product => product.parentId ?? product.id)
                    )
                  )
                    .slice(0, 6)
                    .map(rootId => familyMembers.get(rootId) ?? [])
                    .filter(members => members.length)
                : [];
              return (
                <Card
                  key={roomIndex}
                  className="overflow-hidden border-border/70 shadow-sm"
                >
                  <CardHeader className="bg-muted/40 pb-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f4d842] font-display text-xs font-bold text-black">
                          {String(roomIndex + 1).padStart(2, "0")}
                        </span>
                        <Input
                          value={room.name}
                          onChange={e =>
                            updateRoom(roomIndex, {
                              name: e.target.value.toUpperCase(),
                            })
                          }
                          aria-label={`Nome do ambiente ${roomIndex + 1}`}
                          className="h-9 border-0 bg-transparent px-0 font-display text-base font-bold shadow-none focus-visible:ring-0"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={roomIndex === 0}
                          onClick={() => moveRoom(roomIndex, -1)}
                          title="Subir ambiente"
                        >
                          <ChevronUp className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          disabled={roomIndex === draft.rooms.length - 1}
                          onClick={() => moveRoom(roomIndex, 1)}
                          title="Descer ambiente"
                        >
                          <ChevronDown className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => duplicateRoom(roomIndex)}
                          title="Duplicar ambiente"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          disabled={draft.rooms.length === 1}
                          onClick={() => removeRoom(roomIndex)}
                          title="Excluir ambiente"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="border-b border-border p-4">
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={query}
                            onChange={e => setSearchAt(roomIndex, e.target.value)}
                            // Leitor USB: o código chega seguido de Enter e o produto entra direto.
                            onKeyDown={e => {
                              if (e.key === "Enter" && addScanned(roomIndex, query)) e.preventDefault();
                            }}
                            placeholder="Buscar por referência, descrição ou código de barras"
                            aria-label={`Buscar produto no ambiente ${roomIndex + 1}`}
                            className="h-10 pl-9"
                          />
                        </div>
                        <ScanButton
                          className="h-10 w-10"
                          title={`Adicionar pelo código de barras no ambiente ${roomIndex + 1}`}
                          onDetected={value => {
                            if (addScanned(roomIndex, value)) return;
                            const archived = findProductByScan(products, value);
                            if (archived) {
                              toast.error(`${archived.shortDescription} está arquivado no catálogo. Reative-o para usar no orçamento.`);
                              return;
                            }
                            setSearchAt(roomIndex, value);
                            unknownCode(value);
                          }}
                        />
                      </div>
                      {matches.length ? (
                        <div className="mt-2 overflow-hidden rounded-xl border border-border bg-card">
                          {matches.map(members => {
                            const product = members[0]!;
                            const familyKey = `${roomIndex}-${product.parentId ?? product.id}`;
                            const isFamily = members.length > 1;
                            const expanded = openFamily === familyKey;
                            return (
                              <div key={familyKey} className="border-b border-border last:border-0">
                                <button
                                  onClick={() =>
                                    isFamily
                                      ? setOpenFamily(expanded ? null : familyKey)
                                      : addProduct(roomIndex, product.id)
                                  }
                                  aria-expanded={isFamily ? expanded : undefined}
                                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted"
                                >
                                  <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-md bg-muted">
                                    {product.imageUrl ? (
                                      <img
                                        className="h-full w-full object-contain"
                                        src={product.imageUrl}
                                      />
                                    ) : (
                                      <PackagePlus className="h-4 w-4 text-muted-foreground" />
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <b className="block truncate text-xs">
                                      {isFamily ? product.modelName || product.shortDescription : product.shortDescription}
                                    </b>
                                    <small className="font-mono text-[10px] text-muted-foreground">
                                      {isFamily
                                        ? `${members.length} variações · a partir de ${money(Math.min(...members.map(member => Number(member.unitPrice))))}`
                                        : `Ref. ${product.reference ?? product.code} · ${money(product.unitPrice)}`}
                                    </small>
                                  </span>
                                  {isFamily ? (
                                    <ChevronDown className={`h-4 w-4 text-primary transition ${expanded ? "rotate-180" : ""}`} />
                                  ) : (
                                    <Plus className="h-4 w-4 text-primary" />
                                  )}
                                </button>
                                {isFamily && expanded ? (
                                  <div className="grid grid-cols-1 gap-1.5 bg-muted/40 p-2 sm:grid-cols-2">
                                    {members.map(member => (
                                      <button
                                        key={member.id}
                                        onClick={() => {
                                          addProduct(roomIndex, member.id);
                                          setOpenFamily(null);
                                        }}
                                        className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left hover:border-primary"
                                      >
                                        <span className="min-w-0">
                                          <b className="block truncate text-xs">
                                            {variantLabel(parseAttributes(member.attributes)) || member.shortDescription}
                                          </b>
                                          <small className="font-mono text-[10px] text-muted-foreground">
                                            Ref. {member.reference ?? member.code} · {money(member.unitPrice)} · estoque {Number(member.stockQuantity)}
                                          </small>
                                        </span>
                                        <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                                      </button>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                    <div className="quote-lines">
                      <div className="quote-line-head">
                        <span>Item</span>
                        <span>Descrição do produto</span>
                        <span>Qtd.</span>
                        <span>Valor un.</span>
                        <span>Total</span>
                        <span></span>
                      </div>
                      {room.items.map((item, itemIndex) => {
                        const catalogProduct = item.productId ? productById.get(item.productId) : undefined;
                        const needed = item.productId ? neededByProduct.get(item.productId) ?? 0 : 0;
                        const short = Boolean(catalogProduct && availabilityRows && needed > (availability.get(catalogProduct.id) ?? 0));
                        return (
                        <Fragment key={itemIndex}>
                        <div
                          draggable
                          onDragStart={event => {
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData(
                              "text/plain",
                              String(itemIndex)
                            );
                          }}
                          onDragOver={event => event.preventDefault()}
                          onDrop={event => {
                            event.preventDefault();
                            const fromIndex = Number(
                              event.dataTransfer.getData("text/plain")
                            );
                            if (Number.isInteger(fromIndex))
                              moveItem(roomIndex, fromIndex, itemIndex);
                          }}
                          className="quote-line cursor-grab active:cursor-grabbing"
                          title="Arraste esta linha para reordenar"
                          key={itemIndex}
                        >
                          <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-lg border bg-muted">
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                className="h-full w-full object-contain"
                              />
                            ) : (
                              <FileText className="h-4 w-4 text-muted-foreground" />
                            )}
                          </span>
                          <div className="min-w-0">
                            <Input
                              value={item.shortDescription}
                              onChange={e =>
                                updateItem(roomIndex, itemIndex, {
                                  shortDescription: e.target.value,
                                })
                              }
                              aria-label={`Descrição do item ${(itemGlobalOffsets[roomIndex] ?? 0) + itemIndex + 1}`}
                              title={item.shortDescription}
                              className="h-8 text-ellipsis border-0 bg-transparent px-0 text-sm font-semibold shadow-none focus-visible:ring-0"
                            />
                            <div className="flex gap-2">
                              <Input
                                value={item.code}
                                onChange={e =>
                                  updateItem(roomIndex, itemIndex, {
                                    code: e.target.value,
                                  })
                                }
                                aria-label={`Referência do item ${(itemGlobalOffsets[roomIndex] ?? 0) + itemIndex + 1}`}
                                className="h-6 max-w-44 border-0 bg-transparent px-0 font-mono text-[10px] text-muted-foreground shadow-none focus-visible:ring-0"
                              />
                              <Input
                                value={item.unit}
                                onChange={e =>
                                  updateItem(roomIndex, itemIndex, {
                                    unit: e.target.value.toUpperCase(),
                                  })
                                }
                                aria-label={`Unidade do item ${(itemGlobalOffsets[roomIndex] ?? 0) + itemIndex + 1}`}
                                className="h-6 w-10 border-0 bg-transparent px-0 font-mono text-[10px] text-muted-foreground shadow-none focus-visible:ring-0"
                              />
                            </div>
                          </div>
                          <MoneyInput
                            format="quantity"
                            value={item.quantity}
                            onValueChange={quantity =>
                              updateItem(roomIndex, itemIndex, { quantity })
                            }
                            aria-label={`Quantidade do item ${(itemGlobalOffsets[roomIndex] ?? 0) + itemIndex + 1}`}
                            className="h-9"
                          />
                          <MoneyInput
                            value={item.unitPrice}
                            onValueChange={unitPrice =>
                              updateItem(roomIndex, itemIndex, { unitPrice })
                            }
                            aria-label={`Valor unitário do item ${(itemGlobalOffsets[roomIndex] ?? 0) + itemIndex + 1}`}
                            className="h-9"
                          />
                          <b className="text-right text-sm">
                            {money(item.quantity * item.unitPrice)}
                          </b>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() =>
                              updateRoom(roomIndex, {
                                items: room.items.filter(
                                  (_, index) => index !== itemIndex
                                ),
                              })
                            }
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        {short && catalogProduct ? (
                          <StockShortageHint
                            productId={catalogProduct.id}
                            attributes={catalogProduct.attributes}
                            unit={item.unit}
                            needed={needed}
                            availability={availability}
                            family={familyMembers.get(catalogProduct.parentId ?? catalogProduct.id) ?? []}
                            onSwap={member => {
                              updateItem(roomIndex, itemIndex, {
                                productId: member.id,
                                code: saleReference(member),
                                shortDescription: member.shortDescription,
                                imageUrl: member.imageUrl,
                                unit: member.unit,
                                unitPrice: Number(member.unitPrice),
                              });
                              toast.success(`Trocado por ${member.shortDescription}.`);
                            }}
                          />
                        ) : null}
                        </Fragment>
                        );
                      })}
                      {room.items.length ? (
                        <div className="flex justify-end border-t border-border px-4 py-3">
                          <div className="flex gap-8 text-sm">
                            <span className="italic text-muted-foreground">
                              Total do ambiente
                            </span>
                            <b>{money(summary.rooms[roomIndex])}</b>
                          </div>
                        </div>
                      ) : (
                        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                          Nenhum item neste ambiente.
                        </p>
                      )}
                    </div>
                    <div className="flex border-t border-border p-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          updateRoom(roomIndex, {
                            items: [...room.items, blankItem()],
                          })
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar item manual
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Button
            variant="outline"
            className="w-full border-dashed"
            onClick={addRoom}
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar ambiente
          </Button>
          <Card className="border-border/70 shadow-sm">
            <CardHeader>
              <CardTitle className="font-display text-lg">
                Observações comerciais
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Textarea
                id="quote-notes"
                rows={4}
                value={draft.notes}
                onChange={e => changeDraft({ notes: e.target.value })}
                placeholder="Condições, prazo de entrega, garantia e outras observações."
                aria-label="Observações comerciais"
              />
            </CardContent>
          </Card>
        </div>
        <aside className="space-y-5 xl:sticky xl:top-24 xl:self-start">
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="border-b border-border bg-muted/30 pb-4">
              <CardTitle className="flex items-center gap-2 font-display text-lg">
                <Calculator className="h-4 w-4 text-primary" />
                Resumo financeiro
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-5">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  Produtos e serviços
                </span>
                <b>{money(summary.productsSubtotal)}</b>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_90px] gap-2">
                <Select
                  value={draft.discountMode}
                  onValueChange={(discountMode: QuoteDraft["discountMode"]) =>
                    changeDraft({ discountMode })
                  }
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">Desconto (%)</SelectItem>
                    <SelectItem value="fixed">Desconto (R$)</SelectItem>
                  </SelectContent>
                </Select>
                <MoneyInput
                  className="h-9"
                  value={draft.discountValue}
                  onValueChange={discountValue => changeDraft({ discountValue })}
                  aria-label="Valor do desconto"
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Desconto aplicado</span>
                <span>− {money(summary.discountAmount)}</span>
              </div>
              <QuoteMarginPanel
                items={marginItems}
                productsSubtotal={summary.productsSubtotal}
                discountAmount={summary.discountAmount}
                maxDiscountPercent={Number(settings?.maxDiscountPercent ?? 0)}
                minMarginPercent={Number(settings?.minMarginPercent ?? 0)}
                showCost={showCost}
              />
              <div className="grid grid-cols-[minmax(0,1fr)_90px] items-center gap-2">
                <Label htmlFor="quote-shipping" className="text-xs text-muted-foreground">Frete</Label>
                <MoneyInput
                  id="quote-shipping"
                  className="h-9"
                  value={draft.shipping}
                  onValueChange={shipping => changeDraft({ shipping })}
                />
              </div>
              <div className="border-t border-border pt-4">
                <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                  <span className="pb-1 font-display text-sm font-bold">
                    Total do orçamento
                  </span>
                  <b className="font-display text-2xl tracking-tight">
                    {money(summary.total)}
                  </b>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card className="border-border/70 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="font-display text-lg">
                Condições de pagamento
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-[minmax(0,1fr)_82px] gap-2">
                <Select
                  value={draft.pixDiscountMode}
                  onValueChange={(
                    pixDiscountMode: QuoteDraft["pixDiscountMode"]
                  ) => changeDraft({ pixDiscountMode })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percentage">PIX (%)</SelectItem>
                    <SelectItem value="fixed">PIX (R$)</SelectItem>
                  </SelectContent>
                </Select>
                <MoneyInput
                  className="h-9"
                  value={draft.pixDiscountValue}
                  onValueChange={pixDiscountValue =>
                    changeDraft({ pixDiscountValue })
                  }
                  aria-label="Valor do desconto PIX"
                />
              </div>
              <div className="rounded-xl bg-emerald-500/10 p-3">
                <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-emerald-800 dark:text-emerald-300">
                  À vista no PIX
                </p>
                <p className="mt-1 font-display text-xl font-bold text-emerald-900 dark:text-emerald-200">
                  {money(summary.pixTotal)}
                </p>
                <p className="mt-1 text-[11px] text-emerald-800/70 dark:text-emerald-300/70">
                  Economia de {money(summary.pixDiscountAmount)}
                </p>
              </div>
              <div className="space-y-2">
                <Label>Parcelamento sem juros</Label>
                <Select
                  value={String(draft.installments)}
                  onValueChange={value =>
                    changeDraft({ installments: Number(value) })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(count => (
                      <SelectItem key={count} value={String(count)}>
                        {count}x de {money(summary.total / count)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 rounded-xl border border-border p-3">
                <label className="flex items-center justify-between gap-2 text-sm font-medium">
                  Entrada + crediário
                  <Switch
                    checked={Boolean(draft.entryOffer)}
                    onCheckedChange={checked =>
                      changeDraft({ entryOffer: checked ? { ...DEFAULT_ENTRY_OFFER, installments: Math.max(2, draft.installments) } : null })
                    }
                    aria-label="Oferecer entrada + crediário"
                  />
                </label>
                {draft.entryOffer ? (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="entry-percent" className="text-xs">Entrada (%)</Label>
                        <Input
                          id="entry-percent"
                          className="h-9"
                          type="number"
                          min="1"
                          max="90"
                          step="5"
                          value={draft.entryOffer.entryPercent}
                          onChange={e => changeDraft({ entryOffer: { ...draft.entryOffer!, entryPercent: Math.min(90, Math.max(1, Number(e.target.value) || 1)) } })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="entry-installments" className="text-xs">Parcelas</Label>
                        <Input
                          id="entry-installments"
                          className="h-9"
                          type="number"
                          min="1"
                          max="24"
                          step="1"
                          value={draft.entryOffer.installments}
                          onChange={e => changeDraft({ entryOffer: { ...draft.entryOffer!, installments: Math.min(24, Math.max(1, Math.floor(Number(e.target.value) || 1))) } })}
                        />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{describeEntryOffer(summary.total, draft.entryOffer)}. Aparece no PDF e na mensagem do WhatsApp.</p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Ofereça ao cliente uma entrada e o restante em parcelas no crediário próprio.</p>
                )}
              </div>
              {draft.status === "approved" ? (
                <div className="rounded-xl border border-border p-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-muted-foreground">Forma de pagamento da venda</p>
                  {draft.paymentPlan?.parts.length ? (
                    <ul className="mt-1 space-y-0.5 text-sm">
                      {draft.paymentPlan.parts.map((part, index) => <li key={index}>{describePart(part)}</li>)}
                    </ul>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">Não registrada: aprovado antes desta versão. Revise em Financeiro.</p>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>
          {can("finance") ? (
            <QuoteFinancePanel quoteId={draft.id} quoteStatus={draft.status} />
          ) : null}
          {draft.id && draft.status === "approved" && can("aftersales") ? <AfterSalesQuotePanel quoteId={draft.id} /> : null}
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Excluir orçamento
          </Button>
          <PaymentPlanDialog
            open={planDialog}
            totals={{ total: summary.total, pixTotal: summary.pixTotal }}
            installments={draft.installments}
            entryOffer={draft.entryOffer}
            onCancel={() => setPlanDialog(false)}
            onConfirm={paymentPlan => {
              setPlanDialog(false);
              changeDraft({ status: "approved", paymentPlan });
            }}
          />
          <ConfirmDialog
            open={confirmDelete}
            onOpenChange={setConfirmDelete}
            title={`Excluir o orçamento #${draft.quoteNumber}?`}
            description="O orçamento, seus itens e o histórico de versões serão removidos. Esta ação não pode ser desfeita."
            confirmLabel="Excluir orçamento"
            destructive
            onConfirm={() => remove.mutate({ id: draft.id })}
          />
          <Dialog open={lossDialog !== null} onOpenChange={open => !open && setLossDialog(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Por que a proposta não foi aprovada?</DialogTitle>
                <DialogDescription>
                  O motivo entra no relatório da Visão geral e ajuda a entender
                  o que impede as vendas.
                </DialogDescription>
              </DialogHeader>
              {lossDialog ? (
                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Motivo">
                    {LOST_REASONS.map(reason => (
                      <Button
                        key={reason}
                        type="button"
                        role="radio"
                        aria-checked={lossDialog.reason === reason}
                        variant={lossDialog.reason === reason ? "default" : "outline"}
                        className="justify-start"
                        onClick={() => setLossDialog({ ...lossDialog, reason })}
                      >
                        {LOST_REASON_LABELS[reason]}
                      </Button>
                    ))}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="loss-notes">Detalhe (opcional)</Label>
                    <Input
                      id="loss-notes"
                      maxLength={500}
                      value={lossDialog.notes}
                      placeholder="Ex.: concorrente cobrou 12% menos"
                      onChange={e => setLossDialog({ ...lossDialog, notes: e.target.value })}
                    />
                  </div>
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setLossDialog(null)}>
                  Cancelar
                </Button>
                <Button
                  onClick={() => {
                    if (!lossDialog) return;
                    changeDraft({ status: "lost", lostReason: lossDialog.reason, lostNotes: lossDialog.notes });
                    setLossDialog(null);
                  }}
                >
                  Marcar como não aprovado
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </aside>
      </div>
      {preview ? (
        <section className="no-print overflow-hidden rounded-2xl border border-border bg-muted/40 shadow-sm">
          {previewUrl ? (
            <iframe
              title="Pré-visualização do PDF do orçamento"
              src={`${previewUrl}#toolbar=1&view=FitH`}
              className="h-[85vh] w-full bg-white"
            />
          ) : (
            <p className="grid h-40 place-items-center text-sm text-muted-foreground">
              Gerando pré-visualização…
            </p>
          )}
        </section>
      ) : null}
      <QuotePdfHistoryPanel quoteId={draft.id} />
    </div>
  );
}
