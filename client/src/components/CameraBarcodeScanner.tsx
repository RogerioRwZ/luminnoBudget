import { Button } from "@/components/ui/button";
import { Camera, CameraOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> };
type DetectorConstructor = new (options: { formats: string[] }) => Detector;

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"];

// O leitor nativo existe no Chrome do Android e do Mac. No iPhone, no
// Firefox e no Chrome do Windows usamos o ZXing em WebAssembly, servido
// pelo próprio sistema (sem CDN), carregado só quando a câmera é aberta.
async function loadDetector(): Promise<DetectorConstructor> {
  const native = (window as Window & { BarcodeDetector?: DetectorConstructor & { getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (native) {
    try {
      const supported = (await native.getSupportedFormats?.()) ?? [];
      if (supported.includes("ean_13")) return native;
    } catch {
      // Cai para o ZXing.
    }
  }
  const [{ BarcodeDetector, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
    import("barcode-detector/ponyfill"),
    import("zxing-wasm/reader/zxing_reader.wasm?url"),
  ]);
  prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? wasmUrl : prefix + path) },
  });
  return BarcodeDetector as unknown as DetectorConstructor;
}

// `continuous`: a câmera continua aberta para ler vários produtos seguidos
// (o mesmo código só conta de novo depois de sair do quadro por um instante).
export function CameraBarcodeScanner({
  onDetected,
  continuous = false,
  label = "Ler pela câmera",
}: {
  onDetected: (value: string) => void;
  continuous?: boolean;
  label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const runningRef = useRef(false);
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const [active, setActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");

  const stop = () => {
    runningRef.current = false;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
  };
  useEffect(() => stop, []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("A câmera só funciona em endereço seguro (https) e num dispositivo com câmera. Use o leitor USB ou digite o código.");
      return;
    }
    setStarting(true);
    setMessage("");
    try {
      const [DetectorClass, stream] = await Promise.all([
        loadDetector(),
        navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }),
      ]);
      const video = videoRef.current!;
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setActive(true);
      const detector = new DetectorClass({ formats: FORMATS });
      runningRef.current = true;
      let lastValue = "";
      let lastSeen = 0;
      const scan = async () => {
        if (!runningRef.current) return;
        try {
          const value = (await detector.detect(video))[0]?.rawValue?.trim();
          const now = Date.now();
          if (value && (value !== lastValue || now - lastSeen > 1500)) {
            onDetectedRef.current(value);
            if (!continuous) return stop();
          }
          if (value) {
            lastValue = value;
            lastSeen = now;
          }
        } catch {
          // Um quadro com falha não interrompe a leitura.
        }
        window.setTimeout(scan, 150);
      };
      void scan();
    } catch (error) {
      stop();
      const name = (error as { name?: string })?.name;
      setMessage(
        name === "NotAllowedError"
          ? "A câmera foi bloqueada. Libere o acesso nas permissões do navegador e tente de novo."
          : name === "NotFoundError"
            ? "Nenhuma câmera encontrada neste dispositivo."
            : "Não foi possível abrir a câmera. Use o leitor USB ou digite o código."
      );
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button type="button" variant="outline" onClick={active ? stop : start} disabled={starting}>
        {active ? <CameraOff className="mr-2 h-4 w-4" /> : <Camera className="mr-2 h-4 w-4" />}
        {starting ? "Abrindo câmera…" : active ? "Parar câmera" : label}
      </Button>
      {/* O vídeo fica sempre no DOM: a leitura precisa dele assim que a câmera abre. */}
      <video
        ref={videoRef}
        className={active ? "aspect-video w-full max-w-sm rounded-xl bg-black object-cover" : "hidden"}
        muted
        playsInline
        aria-label="Imagem da câmera"
      />
      {message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </div>
  );
}
