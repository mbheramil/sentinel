import { ERROR_CODES } from '@sentinel/shared';
import type { Role } from '@sentinel/shared';

export interface Actor {
  userId: string | null;
  orgId: string;
  role: Role;
  scopes?: string[];
  apiKeyId?: string;
}

export interface Resource {
  type?: string;
  orgId?: string;
}

const ROLE_RANK: Record<Role, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
  OWNER: 3,
};

export function hasMinRole(actor: Actor, minRole: Role): boolean {
  return ROLE_RANK[actor.role] >= ROLE_RANK[minRole];
}

function forbidden(message = 'Insufficient permissions'): never {
  const err = new Error(message) as Error & { statusCode: number; code: string };
  err.statusCode = 403;
  err.code = ERROR_CODES.FORBIDDEN;
  throw err;
}

/**
 * Authorize an actor to perform an action. Throws a 403-compatible error if denied.
 *
 * Permission matrix:
 *   OWNER  — everything
 *   ADMIN  — everything except OWNER-only (members:remove, members:setRole, org:delete)
 *   EDITOR — reads + create/update tests/projects/environments + trigger runs
 *            cannot manage members, API keys, or integrations
 *   VIEWER — reads only, cannot trigger runs or write anything
 */
export function authorize(actor: Actor, action: string, _resource?: Resource): void {
  // OWNER-only actions
  if (action === 'members:remove' || action === 'members:setRole' || action === 'org:delete') {
    if (actor.role !== 'OWNER') forbidden();
    return;
  }

  // ADMIN+ actions
  const adminActions = new Set([
    'members:list',
    'invitations:create',
    'apiKeys:list',
    'apiKeys:create',
    'apiKeys:revoke',
    'integrations:manage',
  ]);
  if (adminActions.has(action)) {
    if (!hasMinRole(actor, 'ADMIN')) forbidden();
    return;
  }

  // EDITOR+ actions
  const editorActions = new Set([
    'runs:create',
    'runs:cancel',
    'runs:retry',
    'projects:create',
    'projects:update',
    'projects:delete',
    'environments:create',
    'environments:update',
    'environments:delete',
    'tests:create',
    'tests:update',
    'tests:delete',
  ]);
  if (editorActions.has(action)) {
    if (!hasMinRole(actor, 'EDITOR')) forbidden();
    return;
  }

  // All remaining actions (reads) are allowed for VIEWER+, which is the minimum role.
}
