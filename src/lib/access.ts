import { auth } from "@/auth";
import { redirect } from "next/navigation";

export async function requireMember() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user;
}

export async function requireAdmin() {
  const user = await requireMember();
  if (user.role !== "ADMIN") throw new Error("Accès réservé à l’administration.");
  return user;
}

// The private inbox belongs to one account, rather than every administrator.
export function canAccessInstagram(user: { role?: string; email?: string | null }) {
  const owner = (process.env.CRM_INSTAGRAM_ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL ?? "admin@glaura.fr").trim().toLowerCase();
  return user.role === "ADMIN" && user.email?.trim().toLowerCase() === owner;
}

export async function requireInstagramAdmin() {
  const user = await requireAdmin();
  if (!canAccessInstagram(user)) throw new Error("Cette messagerie est privée.");
  return user;
}

export function prospectScope(user: { id: string; role?: string }) {
  return user.role === "ADMIN" ? {} : {
    OR: [
      { assignedToId: user.id },
      { assignedToId: null, tournee: { assignedToId: user.id } },
    ],
  };
}
