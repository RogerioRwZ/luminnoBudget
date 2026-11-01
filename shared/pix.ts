// Gera o "PIX copia e cola" (BR Code estático) conforme o Manual de Padrões
// para Iniciação do PIX do Banco Central (EMV QRCPS-MPM).

export type PixInput = {
  key: string;
  name: string;
  city: string;
  amount?: number | null;
  txid?: string | null;
  description?: string | null;
};

// Remove acentos e caracteres fora do conjunto aceito pelos bancos.
function sanitize(value: string, maxLength: number) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,\-/@]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function field(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

// CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF), exigido no campo 63.
export function crc16(payload: string) {
  let crc = 0xffff;
  for (let index = 0; index < payload.length; index += 1) {
    crc ^= payload.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

// Telefones precisam do formato +55DDDNÚMERO; e-mails, CPF/CNPJ e chaves
// aleatórias seguem como foram cadastrados.
export function normalizePixKey(key: string) {
  const trimmed = key.trim();
  if (trimmed.includes("@") || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("+")) return `+${trimmed.replace(/\D/g, "")}`;
  const digits = trimmed.replace(/\D/g, "");
  if (/^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$/.test(trimmed) || /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(trimmed)) return digits;
  if (/^\(?\d{2}\)?\s?9?\d{4}-?\d{4}$/.test(trimmed)) return `+55${digits}`;
  return trimmed;
}

export function buildPixPayload(input: PixInput) {
  const key = normalizePixKey(input.key);
  if (!key) throw new Error("Cadastre a chave PIX nas configurações da loja.");
  const description = input.description ? sanitize(input.description, 40) : "";
  const merchantAccount = field("00", "br.gov.bcb.pix") + field("01", key) + (description ? field("02", description) : "");
  if (merchantAccount.length > 99) throw new Error("A chave PIX e a descrição são longas demais para o QR Code.");
  const name = sanitize(input.name, 25) || "RECEBEDOR";
  const city = sanitize(input.city, 15) || "BRASIL";
  const txid = (input.txid ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";
  const amount = input.amount && input.amount > 0 ? input.amount.toFixed(2) : "";
  const payload =
    field("00", "01") +
    field("26", merchantAccount) +
    field("52", "0000") +
    field("53", "986") +
    (amount ? field("54", amount) : "") +
    field("58", "BR") +
    field("59", name) +
    field("60", city) +
    field("62", field("05", txid)) +
    "6304";
  return payload + crc16(payload);
}
