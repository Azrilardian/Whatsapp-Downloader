import type { ReactNode } from 'react';
import type { LinkPatternRow } from '@wadl/shared';

export interface LinkPatternPanelProps {
  patterns: LinkPatternRow[];
}

export interface LinkPatternRowProps {
  pattern: LinkPatternRow;
}

export interface LinkPatternFormDialogProps {
  pattern: LinkPatternRow | null;
  trigger: ReactNode;
}
