import type { ReactNode } from 'react';
import type { GroupRow } from '@wadl/shared';

export interface GroupPanelProps {
  groups: GroupRow[];
}

export interface GroupRowProps {
  group: GroupRow;
}

export interface GroupFormDialogProps {
  group: GroupRow | null;
  trigger: ReactNode;
}
