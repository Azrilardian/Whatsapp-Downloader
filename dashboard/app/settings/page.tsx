import { readSettings } from '@/lib/db';
import { SettingsForm } from '@/components/settings-form';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

// FR-19/AD-17: policy values only — secrets (Telegram/VT keys) stay in
// .env and are never shown or editable here.
export default function SettingsPage() {
  const rows = readSettings() ?? [];
  const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return (
    <div>
      <h1 className="mb-1 text-[22px] font-semibold">Settings</h1>
      <p className="mb-5 text-[13px] text-muted-foreground">
        Policy values apply on the worker&apos;s next relevant operation — no restart needed.
      </p>

      <Card className="shadow-none">
        <CardContent className="pt-4">
          <SettingsForm values={values} />
        </CardContent>
      </Card>
    </div>
  );
}
