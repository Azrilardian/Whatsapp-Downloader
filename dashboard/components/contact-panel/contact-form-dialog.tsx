"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveContactAction } from "@/app/whitelists/actions";
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
import type { ContactFormDialogProps } from "./types";

export function ContactFormDialog(props: ContactFormDialogProps) {
  const { contact, trigger } = props;
  const [open, setOpen] = useState(false);

  async function handleSubmit(formData: FormData) {
    const result = await saveContactAction(formData);
    if (result.ok) {
      toast.success(contact ? "Contact updated" : "Contact added");
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
          <DialogTitle>{contact ? "Edit contact" : "Add contact"}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3 mt-2">
          <input type="hidden" name="originalJid" value={contact?.jid ?? ""} />
          <div className="flex flex-col gap-1.5 mb-2">
            <Label htmlFor="jid">Sender identity</Label>
            <Input
              id="jid"
              name="jid"
              defaultValue={contact?.jid ?? ""}
              placeholder="+62 8xx-xxxx-xxxx"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 mb-2">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              name="label"
              defaultValue={contact?.label ?? ""}
              placeholder="e.g. Aji — build host"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="active"
              name="active"
              defaultChecked={contact ? contact.active === 1 : true}
            />
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
