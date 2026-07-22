'use server';

import { revalidatePath } from 'next/cache';
import { saveSettings } from '@/lib/db';
import { SETTINGS_FIELDS } from './settings-config';

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveSettingsAction(formData: FormData): Promise<SaveResult> {
  const values: Record<string, string> = {};
  for (const field of SETTINGS_FIELDS) {
    const raw = String(formData.get(field.key) ?? '').trim();
    if (field.kind === 'int') {
      if (raw === '') {
        return { ok: false, error: `${field.label} is required.` };
      }
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < field.min) {
        return { ok: false, error: `${field.label} must be an integer >= ${field.min}.` };
      }
      values[field.key] = String(parsed);
    } else {
      if (!field.options.includes(raw)) {
        return { ok: false, error: `${field.label} must be one of: ${field.options.join(', ')}.` };
      }
      values[field.key] = raw;
    }
  }

  try {
    saveSettings(values);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to save settings.' };
  }
  revalidatePath('/settings');
  return { ok: true };
}
