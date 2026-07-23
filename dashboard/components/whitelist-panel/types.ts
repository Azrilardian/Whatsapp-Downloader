import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

// FR-12/FR-19: contacts and groups are both a (identity, label, active)
// whitelist entry, edited via the same add/edit/toggle/remove shape — this
// panel/row/dialog set is the one implementation both use.
export interface WhitelistEntryValues {
  id: string;
  label: string | null;
  active: 0 | 1;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export interface WhitelistFieldConfig {
  idFieldName: string;
  originalIdFieldName: string;
  idLabel: string;
  idPlaceholder: string;
  labelPlaceholder: string;
  entityLabel: string; // lowercase singular noun, e.g. "contact" | "group"
}

export interface WhitelistActions {
  save: (formData: FormData) => Promise<SaveResult>;
  setActive: (id: string, active: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export interface WhitelistPanelProps {
  title: string;
  addButtonLabel: string;
  icon: LucideIcon;
  emptyTitle: string;
  emptyDescription: string;
  entries: WhitelistEntryValues[];
  fields: WhitelistFieldConfig;
  actions: WhitelistActions;
}

export interface WhitelistRowProps {
  entry: WhitelistEntryValues;
  fields: WhitelistFieldConfig;
  actions: WhitelistActions;
}

export interface WhitelistFormDialogProps {
  entry: WhitelistEntryValues | null;
  fields: WhitelistFieldConfig;
  actions: WhitelistActions;
  trigger: ReactNode;
}
