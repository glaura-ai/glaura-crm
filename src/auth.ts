import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";

const ALLOWED_GOOGLE_EMAILS = new Set(
  (process.env.ALLOWED_GOOGLE_EMAILS ?? "a.ribeiro@glaura.fr")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
);
const isDev = process.env.NODE_ENV !== "production";
const adminEmail = process.env.CRM_ADMIN_EMAIL ?? "admin@glaura.fr";
const adminPassword = process.env.CRM_ADMIN_PASSWORD ?? "";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google,
    Credentials({
      id: "admin-password",
      name: "Admin password",
      credentials: {
        password: { label: "Mot de passe", type: "password" },
      },
      authorize: async (credentials) => {
        const password = typeof credentials?.password === "string" ? credentials.password : "";
        if (!adminPassword || password !== adminPassword) return null;
        return { id: "admin", email: adminEmail, name: "Admin CRM" };
      },
    }),
    // Dev-only quick login so we can build/test without Google OAuth creds.
    ...(isDev
      ? [
          Credentials({
            id: "dev",
            name: "Dev login",
            credentials: {},
            authorize: async () => ({ id: "dev", email: "dev@glaura.fr", name: "Dev Admin" }),
          }),
        ]
      : []),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async signIn({ profile, user, account }) {
      const email = (profile?.email ?? user?.email ?? "").trim().toLowerCase();
      const member = await prisma.user.findUnique({ where: { email } });
      if (member && !member.active) return false;
      if (account?.provider === "google") {
        if (profile?.email_verified !== true) return false;
        return ALLOWED_GOOGLE_EMAILS.has(email) || Boolean(member?.active && member.accessGrantedAt);
      }
      return true;
    },
    // Check membership on every request: disabling an account revokes existing JWTs.
    async jwt({ token, account, profile, user }) {
      const email = (profile?.email ?? user?.email)?.trim().toLowerCase();
      if (account && email) {
        const isPasswordAdmin = account.provider === "admin-password";
        const name = (profile?.name as string) ?? user?.name ?? null;
        const image = (profile?.picture as string) ?? user?.image ?? null;
        const u = await prisma.user.upsert({
          where: { email },
          update: {
            name: name ?? undefined,
            image: image ?? undefined,
            role: isPasswordAdmin ? "ADMIN" : undefined,
            lastLogin: new Date(),
          },
          create: { email, name, image, role: isPasswordAdmin || email === "dev@glaura.fr" ? "ADMIN" : "COMMERCIAL" },
        });
        token.uid = u.id;
        token.role = u.role;
      }
      if (!token.uid) return null;
      const member = await prisma.user.findUnique({ where: { id: token.uid as string }, select: { active: true, role: true, email: true, accessGrantedAt: true } });
      if (!member?.active) return null;
      const approved = ALLOWED_GOOGLE_EMAILS.has(member.email.toLowerCase()) || member.accessGrantedAt || member.email.toLowerCase() === adminEmail.toLowerCase() || (isDev && member.email === "dev@glaura.fr");
      if (!approved) return null;
      token.role = member.role;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.uid as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
});
