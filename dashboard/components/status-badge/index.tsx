import { Badge } from '@/components/ui/badge';
import { getStatusMeta } from './utils';
import type { StatusBadgeProps } from './types';

export function StatusBadge(props: StatusBadgeProps) {
  const { status } = props;
  const meta = getStatusMeta(status);

  return (
    <Badge variant="outline" className={`border-transparent font-medium ${meta.className}`}>
      {meta.label}
    </Badge>
  );
}
