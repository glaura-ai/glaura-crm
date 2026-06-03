import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/db";

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN ?? "glaura.fr";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    // Restrict to the internal team's Google Workspace domain.
    async signIn({ profile, user }) {
      const email = profile?.email ?? user?.email ?? "";
      return email.toLowerCase().endsWith("@" + ALLOWED_DOMAIN);
    },
    // DB work only on first sign-in (route-handler / Node runtime), never on edge.
    async jwt({ token, account, profile }) {
      if (account && profile?.email) {
        const u = await prisma.user.upsert({
          where: { email: profile.email },
          update: {
            name: (profile.name as string) ?? undefined,
            image: (profile.picture as string) ?? undefined,
            lastLogin: new Date(),
          },
          create: {
            email: profile.email,
            name: (profile.name as string) ?? null,
            image: (profile.picture as string) ?? null,
          },
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
