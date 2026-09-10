import { redirect } from 'next/navigation';

// Cross-project dashboard — Phase 2.
// For Phase 1, redirect to the projects list.
export default function DashboardPage() {
  redirect('/projects');
}
