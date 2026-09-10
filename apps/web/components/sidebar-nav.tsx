'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FolderIcon, LogOutIcon, UserIcon, ShieldIcon } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

function cn(...inputs: Parameters<typeof clsx>) {
  return twMerge(clsx(inputs));
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/projects', label: 'Projects', icon: FolderIcon },
];

interface SidebarNavProps {
  userName?: string | null;
  userEmail?: string | null;
  orgName?: string;
  isOwner?: boolean;
}

export function SidebarNav({ userName, userEmail, orgName, isOwner = false }: SidebarNavProps) {
  const pathname = usePathname();

  const visibleItems: NavItem[] = [
    ...NAV_ITEMS,
    ...(isOwner
      ? [{ href: '/settings/admin', label: 'Admin', icon: ShieldIcon }]
      : []),
  ];

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-border bg-background">
      {/* Logo */}
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <svg
          aria-hidden="true"
          className="h-6 w-6 text-primary"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
        <span className="font-bold tracking-tight">Sentinel</span>
        {orgName && (
          <span className="ml-auto truncate text-xs text-muted-foreground max-w-[80px]" title={orgName}>
            {orgName}
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 px-2 py-3" aria-label="Primary navigation">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground',
              )}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User menu */}
      <div className="border-t border-border p-2">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm',
                'hover:bg-accent hover:text-accent-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
                {(userName ?? userEmail ?? 'U')[0]?.toUpperCase()}
              </span>
              <span className="flex min-w-0 flex-col text-left">
                <span className="truncate font-medium">{userName ?? 'User'}</span>
                <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
              </span>
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="top"
              align="start"
              className="z-50 min-w-[160px] rounded-md border border-border bg-background p-1 shadow-lg"
            >
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent outline-none focus:bg-accent"
                disabled
              >
                <UserIcon className="h-4 w-4" aria-hidden="true" />
                Profile
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10 outline-none focus:bg-destructive/10"
                onSelect={() => signOut({ callbackUrl: '/login' })}
              >
                <LogOutIcon className="h-4 w-4" aria-hidden="true" />
                Sign out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </aside>
  );
}
