import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { SidebarNav } from '@/components/sidebar-nav';
import { prisma } from '@sentinel/db';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  if (!session?.user?.userId) {
    redirect('/login');
  }

  // Check if the user is an OWNER in any org (for admin nav visibility)
  let isOwner = false;
  try {
    const ownerMembership = await prisma.membership.findFirst({
      where: { userId: session.user.userId, role: 'OWNER' },
      select: { orgId: true },
    });
    isOwner = ownerMembership !== null;
  } catch {
    // Non-critical — default to false
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <SidebarNav
        userName={session.user.name}
        userEmail={session.user.email}
        isOwner={isOwner}
      />
      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
    </div>
  );
}
