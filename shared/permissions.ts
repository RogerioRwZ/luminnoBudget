export const USER_ROLES = ["admin", "user", "sales", "stock", "finance"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  user: "Equipe completa",
  sales: "Vendas",
  stock: "Expedição e estoque",
  finance: "Financeiro",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: "Tudo, inclusive usuários, configurações e backup.",
  user: "Todas as áreas do dia a dia, sem administração.",
  sales: "Orçamentos, clientes, catálogo, agenda e PDFs. Sem financeiro, estoque, compras, custos e relatórios.",
  stock: "Estoque, conferência, compras, catálogo e agenda.",
  finance: "Financeiro, comissões, relatórios, orçamentos, clientes e PDFs.",
};

// Áreas do sistema. Cada página e cada rota do servidor pertence a uma ou
// mais delas; a Visão geral e as Configurações (só leitura) são de todos.
export type Area = "quotes" | "agenda" | "pdfs" | "finance" | "catalog" | "stock" | "purchases" | "customers" | "reports";
const ALL: Area[] = ["quotes", "agenda", "pdfs", "finance", "catalog", "stock", "purchases", "customers", "reports"];

const ROLE_AREAS: Record<UserRole, Area[]> = {
  admin: ALL,
  user: ALL,
  sales: ["quotes", "agenda", "pdfs", "catalog", "customers"],
  stock: ["agenda", "catalog", "stock", "purchases"],
  finance: ["quotes", "pdfs", "finance", "customers", "reports"],
};

export function canAccess(role: string | null | undefined, ...areas: Area[]) {
  const allowed = ROLE_AREAS[role as UserRole];
  return Boolean(allowed) && areas.some((area) => allowed.includes(area));
}

// Área de cada página (as que não aparecem aqui são de todos).
export const PAGE_AREAS: Record<string, Area> = {
  "/orcamentos": "quotes",
  "/operacao": "quotes",
  "/agenda": "agenda",
  "/historico-pdfs": "pdfs",
  "/financeiro": "finance",
  "/catalogo": "catalog",
  "/estoque": "stock",
  "/compras": "purchases",
  "/clientes": "customers",
  "/comissoes": "finance",
  "/relatorios": "reports",
};

// Preço de custo e margem: escondidos do perfil Vendas, que negocia com o
// cliente. O servidor remove o custo das respostas para esse perfil.
export function canSeeCost(role: string | null | undefined) {
  return Boolean(ROLE_AREAS[role as UserRole]) && role !== "sales";
}

export function canOpenPage(role: string | null | undefined, path: string) {
  const entry = Object.entries(PAGE_AREAS).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return !entry || canAccess(role, entry[1]);
}
