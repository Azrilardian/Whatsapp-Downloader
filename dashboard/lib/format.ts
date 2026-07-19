export function formatEventTime(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
