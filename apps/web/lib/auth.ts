import NextAuth, { type DefaultSession } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { prisma } from '@sentinel/db';
import argon2 from 'argon2';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      userId: string;
      orgId: string | undefined;
      role: string | undefined;
    };
  }
}

/**
 * The claims this app puts on the JWT.
 *
 * Declared locally rather than via `declare module 'next-auth/jwt'`: in
 * next-auth v5 that path is a bare re-export of `@auth/core/jwt`, so augmenting
 * it does nothing — and `@auth/core` is a transitive dependency that pnpm does
 * not expose here, so it cannot be augmented either. `JWT` extends
 * `Record<string, unknown>`, so writes are fine and only reads need narrowing.
 */
interface SentinelClaims {
  userId?: string;
  orgId?: string;
  role?: string;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email as string },
        });

        if (!user?.passwordHash) return null;

        const valid = await argon2.verify(user.passwordHash, credentials.password as string);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
        const membership = await prisma.membership.findFirst({
          where: { userId: user.id },
          orderBy: { createdAt: 'asc' },
        });
        token.orgId = membership?.orgId ?? undefined;
        token.role = membership?.role ?? undefined;
      }
      return token;
    },
    async session({ session, token }) {
      const claims = token as SentinelClaims;
      session.user.userId = claims.userId ?? '';
      session.user.orgId = claims.orgId;
      session.user.role = claims.role;
      return session;
    },
  },
});
