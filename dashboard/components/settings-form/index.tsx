'use client';

import { toast } from 'sonner';
import { saveSettingsAction } from '@/app/settings/actions';
import { SETTINGS_FIELDS } from '@/app/settings/settings-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { SettingsFormProps } from './types';

export function SettingsForm(props: SettingsFormProps) {
  const { values } = props;

  async function handleSubmit(formData: FormData) {
    const result = await saveSettingsAction(formData);
    if (result.ok) toast.success('Settings saved');
    else toast.error(result.error);
  }

  return (
    <form action={handleSubmit} className="flex flex-col gap-5">
      {SETTINGS_FIELDS.map((field) => (
        <div key={field.key} className="flex items-center justify-between gap-4 border-b border-border pb-4">
          <div className="min-w-0">
            <Label htmlFor={field.key} className="text-[13px] font-medium">
              {field.label}
            </Label>
            <p className="text-xs text-muted-foreground">{field.help}</p>
          </div>
          {field.kind === 'int' ? (
            <Input
              id={field.key}
              name={field.key}
              type="number"
              min={field.min}
              step={1}
              defaultValue={values[field.key] ?? ''}
              className="w-40 shrink-0"
              required
            />
          ) : (
            <Select name={field.key} defaultValue={values[field.key] ?? field.options[0]}>
              <SelectTrigger id={field.key} className="w-40 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {field.options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ))}
      <div className="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  );
}
