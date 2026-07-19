"use client";

import { useState } from "react";
import { toast } from "sonner";
import { saveLinkPatternAction } from "@/app/whitelists/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LinkPatternFormDialogProps } from "./types";

export function LinkPatternFormDialog(props: LinkPatternFormDialogProps) {
  const { pattern, trigger } = props;
  const [open, setOpen] = useState(false);

  async function handleSubmit(formData: FormData) {
    const result = await saveLinkPatternAction(formData);
    if (result.ok) {
      toast.success(pattern ? "Link pattern updated" : "Link pattern added");
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
          <DialogTitle>
            {pattern ? "Edit link pattern" : "Add link pattern"}
          </DialogTitle>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3 mt-2">
          <input
            type="hidden"
            name="originalPattern"
            value={pattern?.pattern ?? ""}
          />
          <div className="flex flex-col gap-1.5 mb-2">
            <Label htmlFor="pattern">Pattern</Label>
            <Input
              id="pattern"
              name="pattern"
              defaultValue={pattern?.pattern ?? ""}
              placeholder="*.zip or domain.com/*"
              className="font-mono"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5 mb-2">
            <Label htmlFor="type">Type</Label>
            <Select name="type" defaultValue={pattern?.type ?? "extension"}>
              <SelectTrigger id="type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="extension">extension</SelectItem>
                <SelectItem value="domain">domain</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="active"
              name="active"
              defaultChecked={pattern ? pattern.active === 1 : true}
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
