import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/empty-state';
import { ContactFormDialog } from './contact-form-dialog';
import { ContactRow } from './contact-row';
import type { ContactPanelProps } from './types';

export function ContactPanel(props: ContactPanelProps) {
  const { contacts } = props;

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-border px-4 py-3.5">
        <CardTitle className="text-sm">Contacts</CardTitle>
        <ContactFormDialog contact={null} trigger={<Button size="sm">+ Add contact</Button>} />
      </CardHeader>
      <CardContent className="p-0">
        {contacts.length === 0 ? (
          <EmptyState icon={Users} title="No contacts yet" description="Add a sender identity to start whitelisting messages." />
        ) : (
          contacts.map((contact) => <ContactRow key={contact.jid} contact={contact} />)
        )}
      </CardContent>
    </Card>
  );
}
