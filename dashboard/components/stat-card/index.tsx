import { Card } from '@/components/ui/card';
import type { StatCardProps } from './types';

const TONE_CLASS: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'border-border',
  warning: 'border-[rgba(168,65,42,0.3)] bg-[rgba(168,65,42,0.04)]',
};

const VALUE_TONE_CLASS: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'text-foreground',
  warning: 'text-[#8a3520]',
};

const LABEL_TONE_CLASS: Record<NonNullable<StatCardProps['tone']>, string> = {
  neutral: 'text-muted-foreground',
  warning: 'text-[#8a3520]',
};

export function StatCard(props: StatCardProps) {
  const { value, label, tone = 'neutral' } = props;

  return (
    <Card className={`gap-1 px-4.5 py-4 shadow-none ${TONE_CLASS[tone]}`}>
      <div className={`text-[26px] font-semibold ${VALUE_TONE_CLASS[tone]}`}>{value}</div>
      <div className={`text-xs ${LABEL_TONE_CLASS[tone]}`}>{label}</div>
    </Card>
  );
}
