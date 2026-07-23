"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WhitelistFormDialogProps } from "./types";

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function WhitelistFormDialog(props: WhitelistFormDialogProps) {
  const { entry, fields, actions, trigger } = props;
  const [open, setOpen] = useState(false);

  async function handleSubmit(formData: FormData) {
    const result = await actions.save(formData);
    if (result.ok) {
      toast.success(`${capitalize(fields.entityLabel)} ${entry ? "updated" : "added"}`);
      setOpen(false);
    } else {
      toast.error(result.error);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{entry ? `Edit ${fields.entityLabel}` : `Add ${fields.entityLabel}`}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3 mt-2">
          <input type="hidden" name={fields.originalIdFieldName} value={entry?.id ?? ""} />
          <div className="flex flex-col gap-1.5 mb-2">
            <Label htmlFor={fields.idFieldName}>{fields.idLabel}</Label>
            <Input
              id={fields.idFieldName}
              name={fields.idFieldName}
              defaultValue={entry?.id ?? ""}
              placeholder={fields.idPlaceholder}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 mb-2">
            <Label htmlFor="label">Label</Label>
            <Input id="label" name="label" defaultValue={entry?.label ?? ""} placeholder={fields.labelPlaceholder} />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="active" name="active" defaultChecked={entry ? entry.active === 1 : true} />
            <Label htmlFor="active" className="text-sm font-normal">
              active
            </Label>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
