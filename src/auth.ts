import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "glaura.fr";
const isDev = process.env.NODE_ENV !== "production";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google,
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
    async signIn({ profile, user }) {
      const email = (profile?.email ?? user?.email ?? "").toLowerCase();
      return email.endsWith("@" + ALLOWED_DOMAIN);
    },
    // DB work only on first sign-in (Node runtime), never on edge.
    async jwt({ token, account, profile, user }) {
      const email = profile?.email ?? user?.email;
      if (account && email) {
        const name = (profile?.name as string) ?? user?.name ?? null;
        const image = (profile?.picture as string) ?? user?.image ?? null;
        const u = await prisma.user.upsert({
          where: { email },
          update: { name: name ?? undefined, image: image ?? undefined, lastLogin: new Date() },
          create: { email, name, image, role: email === "dev@glaura.fr" ? "ADMIN" : "COMMERCIAL" },
        });
        token.uid = u.id;
        token.role = u.role;
      }
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
