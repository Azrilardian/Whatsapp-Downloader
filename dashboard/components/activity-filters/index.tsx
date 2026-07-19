'use client';

import { ITEM_STATUSES } from '@wadl/shared/status';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getStatusMeta } from '@/components/status-badge/utils';
import type { ActivityFiltersProps } from './types';

export function ActivityFilters(props: ActivityFiltersProps) {
  const { filters, contactOptions, onFieldChange } = props;

  return (
    <div className="mb-4 flex flex-wrap gap-2.5">
      <Select value={filters.status} onValueChange={(value) => onFieldChange('status', value)}>
        <SelectTrigger className="w-[160px]" aria-label="Filter by status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          {ITEM_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {getStatusMeta(status).label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.contact} onValueChange={(value) => onFieldChange('contact', value)}>
        <SelectTrigger className="w-[180px]" aria-label="Filter by contact">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All contacts</SelectItem>
          {contactOptions.map((contact) => (
            <SelectItem key={contact} value={contact}>
              {contact}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={filters.date} onValueChange={(value) => onFieldChange('date', value)}>
        <SelectTrigger className="w-[130px]" aria-label="Filter by date">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All time</SelectItem>
          <SelectItem value="today">Today</SelectItem>
          <SelectItem value="yesterday">Yesterday</SelectItem>
        </SelectContent>
      </Select>

      <Input
        value={filters.search}
        onChange={(e) => onFieldChange('search', e.target.value)}
        placeholder="Search filename or link"
        aria-label="Search filename or link"
        className="min-w-[180px] flex-1"
      />
    </div>
  );
}
