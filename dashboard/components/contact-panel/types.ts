import type { ReactNode } from 'react';
import type { ContactRow } from '@wadl/shared';

export interface ContactPanelProps {
  contacts: ContactRow[];
}

export interface ContactRowProps {
  contact: ContactRow;
}

export interface ContactFormDialogProps {
  contact: ContactRow | null;
  trigger: ReactNode;
}
