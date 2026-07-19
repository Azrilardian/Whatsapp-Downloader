import type { EventWithContext } from '@/lib/db';
import type { FiltersState } from './types';

function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function matchesDate(createdAt: string, filter: FiltersState['date']): boolean {
  if (filter === 'all') return true;
  const today = utcDateString(new Date());
  const yesterday = utcDateString(new Date(Date.now() - 86_400_000));
  const eventDate = createdAt.slice(0, 10);
  return filter === 'today' ? eventDate === today : eventDate === yesterday;
}

export function filterEvents(events: EventWithContext[], filters: FiltersState): EventWithContext[] {
  const search = filters.search.trim().toLowerCase();

  return events.filter((event) => {
    if (filters.status !== 'all' && event.status !== filters.status) return false;
    if (filters.contact !== 'all' && event.sender_jid !== filters.contact) return false;
    if (!matchesDate(event.created_at, filters.date)) return false;
    if (search) {
      const filename = (event.filename ?? '').toLowerCase();
      const url = (event.source_url ?? '').toLowerCase();
      if (!filename.includes(search) && !url.includes(search)) return false;
    }
    return true;
  });
}

export function getDistinctContacts(events: EventWithContext[]): string[] {
  const contacts = new Set<string>();
  for (const event of events) {
    if (event.sender_jid) contacts.add(event.sender_jid);
  }
  return Array.from(contacts).sort();
}
