'use server';

import { revalidatePath } from 'next/cache';
import type { LinkPatternType } from '@wadl/shared';
import {
  deleteContact,
  deleteLinkPattern,
  saveContact,
  saveLinkPattern,
  setContactActive,
  setLinkPatternActive,
} from '@/lib/db';

export type SaveResult = { ok: true } | { ok: false; error: string };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

export async function saveContactAction(formData: FormData): Promise<SaveResult> {
  const originalJid = str(formData, 'originalJid') || null;
  const jid = str(formData, 'jid');
  if (!jid) return { ok: false, error: 'Sender identity is required.' };
  const label = str(formData, 'label') || null;
  const active = formData.get('active') ? 1 : 0;
  try {
    saveContact(originalJid, jid, label, active);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save contact.' };
  }
  revalidatePath('/whitelists');
  return { ok: true };
}

export async function setContactActiveAction(jid: string, active: boolean): Promise<void> {
  setContactActive(jid, active ? 1 : 0);
  revalidatePath('/whitelists');
}

export async function deleteContactAction(jid: string): Promise<void> {
  deleteContact(jid);
  revalidatePath('/whitelists');
}

export async function saveLinkPatternAction(formData: FormData): Promise<SaveResult> {
  const originalPattern = str(formData, 'originalPattern') || null;
  const pattern = str(formData, 'pattern');
  if (!pattern) return { ok: false, error: 'Pattern is required.' };
  const type = str(formData, 'type') as LinkPatternType;
  if (type !== 'domain' && type !== 'extension') return { ok: false, error: 'Type must be domain or extension.' };
  const active = formData.get('active') ? 1 : 0;
  try {
    saveLinkPattern(originalPattern, pattern, type, active);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save link pattern.' };
  }
  revalidatePath('/whitelists');
  return { ok: true };
}

export async function setLinkPatternActiveAction(pattern: string, active: boolean): Promise<void> {
  setLinkPatternActive(pattern, active ? 1 : 0);
  revalidatePath('/whitelists');
}

export async function deleteLinkPatternAction(pattern: string): Promise<void> {
  deleteLinkPattern(pattern);
  revalidatePath('/whitelists');
}
