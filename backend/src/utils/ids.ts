import { customAlphabet } from 'nanoid';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 20);

export const ID_PREFIX = {
  user: 'usr',
  company: 'cmp',
  source: 'src',
  document: 'doc',
  contact: 'ctc',
  usage: 'usg',
  invoice: 'inv',
  member: 'mem',
  invitation: 'invt',
  oauthCredential: 'oac',
} as const;

export type IdPrefix = (typeof ID_PREFIX)[keyof typeof ID_PREFIX];

export function generateId(prefix: IdPrefix): string {
  return `${prefix}_${nanoid()}`;
}
