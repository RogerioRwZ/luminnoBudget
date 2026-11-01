import QRCode from "qrcode";

// QR Code do "PIX copia e cola", em PNG (data URL) para tela e PDF.
export function pixQrDataUrl(payload: string, width = 256) {
  return QRCode.toDataURL(payload, { errorCorrectionLevel: "M", margin: 1, width });
}
