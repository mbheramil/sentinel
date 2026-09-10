'use client';

import { use } from 'react';
import Link from 'next/link';
import { CalendarIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  params: Promise<{ slug: string }>;
}

export default function SchedulesPage({ params }: Props) {
  const { slug } = use(params);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <nav className="text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:underline">Projects</Link>
        {' / '}
        <Link href={`/projects/${slug}`} className="hover:underline">{slug}</Link>
        {' / '}
        <span className="text-foreground">Schedules</span>
      </nav>

      <h1 className="text-xl font-semibold">Schedules</h1>

      <Card>
        <CardContent className="flex flex-col items-center py-16 gap-3">
          <CalendarIcon className="h-12 w-12 text-muted-foreground/40" aria-hidden="true" />
          <p className="text-sm font-medium text-muted-foreground">Scheduled runs coming soon</p>
          <p className="text-xs text-muted-foreground text-center max-w-xs">
            You will be able to trigger test runs on a cron schedule — daily, hourly, or a custom interval — and get alerted when they fail.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
