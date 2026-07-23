"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveGroupAction } from "@/app/whitelists/actions";
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
import type { GroupFormDialogProps } from "./types";

export function GroupFormDialog(props: GroupFormDialogProps) {
  const { group, trigger } = props;
  const [open, setOpen] = useState(false);

  async function handleSubmit(formData: FormData) {
    const result = await saveGroupAction(formData);
    if (result.ok) {
      toast.success(group ? "Group updated" : "Group added");
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
          <DialogTitle>{group ? "Edit group" : "Add group"}</DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3 mt-2">
          <input type="hidden" name="originalGroupJid" value={group?.group_jid ?? ""} />
          <div className="flex flex-col gap-1.5 mb-2">
            <Label htmlFor="groupJid">Group identity</Label>
            <Input
              id="groupJid"
              name="groupJid"
              defaultValue={group?.group_jid ?? ""}
              placeholder="1234567890-1234567890@g.us"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 mb-2">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              name="label"
              defaultValue={group?.label ?? ""}
              placeholder="e.g. Build team"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="active"
              name="active"
              defaultChecked={group ? group.active === 1 : true}
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
