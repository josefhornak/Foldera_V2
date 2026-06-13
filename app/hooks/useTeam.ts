import useSWR from 'swr';
import { api } from '~/lib/api';

export type Role = 'admin' | 'member';

export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  role: Role;
  isYou: boolean;
}

export interface PendingInvite {
  id: string;
  email: string;
  role: Role;
}

export function useTeam(companyId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<{ members: TeamMember[]; invitations: PendingInvite[]; role: Role }>(
    companyId ? `/api/companies/${companyId}/members` : null
  );
  return { members: data?.members, invitations: data?.invitations, role: data?.role, error, isLoading, mutate };
}

export function inviteMember(companyId: string, email: string, role: Role) {
  return api(`/api/companies/${companyId}/invitations`, { method: 'POST', body: { email, role } });
}
export function revokeInvite(companyId: string, invId: string) {
  return api(`/api/companies/${companyId}/invitations/${invId}`, { method: 'DELETE' });
}
export function changeMemberRole(companyId: string, userId: string, role: Role) {
  return api(`/api/companies/${companyId}/members/${userId}`, { method: 'PATCH', body: { role } });
}
export function removeMember(companyId: string, userId: string) {
  return api(`/api/companies/${companyId}/members/${userId}`, { method: 'DELETE' });
}
