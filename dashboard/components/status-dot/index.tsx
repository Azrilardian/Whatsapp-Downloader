import type { StatusDotProps } from './types';

const SIZE_CLASS: Record<NonNullable<StatusDotProps['size']>, string> = {
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
};

export function StatusDot(props: StatusDotProps) {
  const { colorClassName, size = 'sm' } = props;

  return <span className={`inline-flex shrink-0 rounded-full ${SIZE_CLASS[size]} ${colorClassName}`} />;
}
