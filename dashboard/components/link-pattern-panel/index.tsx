import { Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { LinkPatternFormDialog } from './link-pattern-form-dialog';
import { LinkPatternRow } from './link-pattern-row';
import type { LinkPatternPanelProps } from './types';

export function LinkPatternPanel(props: LinkPatternPanelProps) {
  const { patterns } = props;

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <CardTitle className="text-sm">Link patterns</CardTitle>
        <LinkPatternFormDialog pattern={null} trigger={<Button size="sm">+ Add pattern</Button>} />
      </CardHeader>
      <CardContent className="p-0">
        {patterns.length === 0 ? (
          <EmptyState icon={Link2} title="No link patterns yet" description="Add a domain or extension to allow downloads from it." />
        ) : (
          patterns.map((pattern) => <LinkPatternRow key={pattern.pattern} pattern={pattern} />)
        )}
      </CardContent>
    </Card>
  );
}
