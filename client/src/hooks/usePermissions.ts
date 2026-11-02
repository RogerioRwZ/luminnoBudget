import { trpc } from "@/lib/trpc";
import { canAccess, type Area } from "@shared/permissions";

// Perfil do usuário logado. O servidor também confere cada acesso; aqui é só
// para não mostrar o que o perfil não pode usar.
export function usePermissions() {
  const { data } = trpc.auth.status.useQuery(undefined, { staleTime: Infinity });
  const role = data?.user?.role;
  return { role, isAdmin: role === "admin", can: (...areas: Area[]) => canAccess(role, ...areas) };
}
