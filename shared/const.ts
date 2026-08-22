export const COOKIE_NAME = "luminno_session";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = "Acesso não autenticado.";
export const NOT_ADMIN_ERR_MSG = "Acesso restrito a administradores.";

// Compatibilidade temporária para módulos de infraestrutura legados que não são
// mais registrados pela aplicação autônoma.
export const OAUTH_STATE_COOKIE = "oauth_state_legacy";
export type OAuthState = { redirectUri: string; nonce?: string };
export const encodeOAuthState = (state: OAuthState): string => btoa(JSON.stringify(state));
export const decodeOAuthState = (state: string): OAuthState => {
  try {
    const parsed = JSON.parse(atob(state));
    return parsed && typeof parsed.redirectUri === "string" ? parsed : { redirectUri: "" };
  } catch {
    return { redirectUri: "" };
  }
};
