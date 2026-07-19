import type { FiltersField, FiltersState } from '@/components/activity-board/types';

export interface ActivityFiltersProps {
  filters: FiltersState;
  contactOptions: string[];
  onFieldChange: (field: FiltersField, value: string) => void;
}
