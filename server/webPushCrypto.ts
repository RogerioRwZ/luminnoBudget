import { createECDH, createPrivateKey, createPublicKey, generateKeyPairSync, hkdfSync, randomBytes, createCipheriv, sign, type JsonWebKey } from "node:crypto";

// Web Push sem dependências: assinatura VAPID (RFC 8292) e criptografia do
// conteúdo aes128gcm (RFC 8291), com o crypto do próprio Node.

export const b64url = (data: Buffer | Uint8Array) => Buffer.from(data).toString("base64url");
export const fromB64url = (text: string) => Buffer.from(text, "base64url");

export type VapidKeys = { publicKey: string; privateJwk: JsonWebKey };

export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  return { publicKey: b64url(Buffer.concat([Buffer.from([4]), fromB64url(jwk.x!), fromB64url(jwk.y!)])), privateJwk: jwk };
}

// Cabeçalho Authorization: JWT ES256 com o serviço de push como audiência.
export function vapidAuthorization(endpoint: string, subject: string, keys: VapidKeys, now = new Date()) {
  const header = b64url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60, sub: subject })));
  const unsigned = `${header}.${claims}`;
  const key = createPrivateKey({ key: keys.privateJwk, format: "jwk" });
  const signature = sign("sha256", Buffer.from(unsigned), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${b64url(signature)}, k=${keys.publicKey}`;
}

export function vapidPublicKeyObject(keys: VapidKeys) {
  const { d: _d, ...publicJwk } = keys.privateJwk;
  return createPublicKey({ key: publicJwk, format: "jwk" });
}

const hkdf = (ikm: Buffer, salt: Buffer, info: Buffer, length: number) => Buffer.from(hkdfSync("sha256", ikm, salt, info, length));

// Corpo cifrado para um aparelho (p256dh e auth vêm da inscrição do navegador).
// Um único registro: cabeçalho (salt, tamanho do registro, chave pública
// efêmera) + conteúdo com o delimitador 0x02 + tag do GCM.
export function encryptPayload(payload: Buffer, p256dh: string, auth: string, options: { salt?: Buffer; serverKeys?: ReturnType<typeof createECDH> } = {}) {
  const userPublicKey = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  if (userPublicKey.length !== 65 || authSecret.length !== 16) throw new Error("Inscrição de aviso inválida.");
  const server = options.serverKeys ?? createECDH("prime256v1");
  if (!options.serverKeys) server.generateKeys();
  const serverPublicKey = server.getPublicKey();
  const sharedSecret = server.computeSecret(userPublicKey);
  const salt = options.salt ?? randomBytes(16);
  const ikm = hkdf(sharedSecret, authSecret, Buffer.concat([Buffer.from("WebPush: info\0"), userPublicKey, serverPublicKey]), 32);
  const contentKey = hkdf(ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdf(ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12);
  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([serverPublicKey.length]), serverPublicKey, encrypted]);
}
