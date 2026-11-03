import { createDecipheriv, createECDH, hkdfSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { b64url, encryptPayload, fromB64url, generateVapidKeys, vapidAuthorization, vapidPublicKeyObject } from "./webPushCrypto";

// Exemplo do Apêndice A da RFC 8291.
const rfc = {
  plaintext: "When I grow up, I want to be a watermelon",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

describe("Web Push", () => {
  it("cifra exatamente como o exemplo da RFC 8291", () => {
    const serverKeys = createECDH("prime256v1");
    serverKeys.setPrivateKey(fromB64url(rfc.asPrivate));
    const body = encryptPayload(Buffer.from(rfc.plaintext), rfc.uaPublic, rfc.auth, { salt: fromB64url(rfc.salt), serverKeys });
    expect(b64url(body)).toBe(rfc.body);
  });

  it("o navegador consegue decifrar o que foi cifrado com chaves novas", () => {
    const ua = createECDH("prime256v1");
    ua.generateKeys();
    const auth = Buffer.alloc(16, 7);
    const body = encryptPayload(Buffer.from('{"title":"Olá"}'), b64url(ua.getPublicKey()), b64url(auth));
    const salt = body.subarray(0, 16);
    const keyLength = body[20]!;
    const serverPublic = body.subarray(21, 21 + keyLength);
    const shared = ua.computeSecret(serverPublic);
    const ikm = Buffer.from(hkdfSync("sha256", shared, auth, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), serverPublic]), 32));
    const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
    const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
    const encrypted = body.subarray(21 + keyLength);
    const decipher = createDecipheriv("aes-128-gcm", key, nonce);
    decipher.setAuthTag(encrypted.subarray(encrypted.length - 16));
    const plain = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()]);
    expect(plain.subarray(0, -1).toString()).toBe('{"title":"Olá"}');
    expect(plain.at(-1)).toBe(2);
  });

  it("assina o VAPID com ES256 para a origem do serviço de push", () => {
    const keys = generateVapidKeys();
    expect(fromB64url(keys.publicKey)).toHaveLength(65);
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", "mailto:loja@example.com", keys, new Date("2026-11-03T12:00:00Z"));
    const [, token, publicKey] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(publicKey).toBe(keys.publicKey);
    const [head, claims, signature] = token!.split(".");
    expect(JSON.parse(fromB64url(claims!).toString())).toEqual({ aud: "https://fcm.googleapis.com", exp: Date.parse("2026-11-03T12:00:00Z") / 1000 + 12 * 60 * 60, sub: "mailto:loja@example.com" });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: vapidPublicKeyObject(keys), dsaEncoding: "ieee-p1363" }, fromB64url(signature!))).toBe(true);
  });
});
