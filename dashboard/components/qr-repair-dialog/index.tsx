import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import type { QrRepairDialogProps } from './types';

export function QrRepairDialog(props: QrRepairDialogProps) {
  const { qrDataUrl } = props;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Show QR to re-pair</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[320px] text-center">
        <DialogHeader>
          <DialogTitle>Re-pair WhatsApp session</DialogTitle>
          <DialogDescription>Scan this code with the linked device.</DialogDescription>
        </DialogHeader>
        <div className="mx-auto flex h-[220px] w-[220px] items-center justify-center overflow-hidden rounded-lg border border-border">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL, not an optimizable remote asset
            <img src={qrDataUrl} alt="WhatsApp pairing QR code" className="h-full w-full object-contain" />
          ) : (
            <p className="px-4 text-xs text-muted-foreground">Waiting for a fresh QR from the worker…</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
