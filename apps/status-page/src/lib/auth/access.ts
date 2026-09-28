import type { AccessConfig } from '@flarewatch/shared';

export type Identity =
  | {
      kind: 'password';
      /** A hash of the admin secret it signed in with, so a new password ends the session. */
      secret: string;
    }
  | {
      kind: 'provider';
      provider: string;
      /** Shown in the account menu. */
      name: string;
      email?: string;
      emailVerified: boolean;
      groups: string[];
      githubLogin?: string;
    };

/** What a signed-in person may see. A member with groups sees published monitors plus those groups. */
export type Principal = { role: 'operator' } | { role: 'member'; groups: 'all' | string[] };

function matches(rule: string, identity: Extract<Identity, { kind: 'provider' }>): boolean {
  if (rule.startsWith('group:')) return identity.groups.includes(rule.slice('group:'.length));
  if (rule.startsWith('github:')) {
    return identity.githubLogin?.toLowerCase() === rule.slice('github:'.length).toLowerCase();
  }
  // An unverified address proves nothing about who signed in.
  const email = identity.emailVerified ? identity.email?.toLowerCase() : undefined;
  if (!email) return false;
  const lowerRule = rule.toLowerCase();
  return lowerRule.startsWith('*@') ? email.endsWith(lowerRule.slice(1)) : email === lowerRule;
}

/** Checked on every request, so removing someone from the config locks them out at once. */
export function principalFor(access: AccessConfig, identity: Identity): Principal | null {
  if (identity.kind === 'password') return { role: 'operator' };
  if (!access.providers?.some((provider) => provider.id === identity.provider)) return null;
  const any = (rules: string[] | undefined) =>
    (rules ?? []).some((rule) => matches(rule, identity));

  if (any(access.operators)) return { role: 'operator' };
  if (any(access.members)) return { role: 'member', groups: 'all' };
  const groups = Object.values(access.audiences ?? {})
    .filter((audience) => any(audience.members))
    .flatMap((audience) => audience.groups);
  return groups.length > 0 ? { role: 'member', groups: [...new Set(groups)] } : null;
}
