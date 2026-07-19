import type { Metadata } from 'next';
import './globals.css';
import { readWorkerState } from '@/lib/db';
import { SidebarNav } from '@/components/sidebar-nav';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: 'WhatsApp Downloader',
  description: 'Local control dashboard — whitelists, event log, quarantine',
};

export default function RootLayout(props: { children: React.ReactNode }) {
  const { children } = props;
  const workerState = readWorkerState();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <SidebarProvider>
          <SidebarNav connectionStatus={workerState?.connection_status ?? null} />
          <SidebarInset>
            <div className="flex items-center border-b border-border px-4 py-2 md:hidden">
              <SidebarTrigger />
            </div>
            <main className="max-w-[1040px] flex-1 px-10 py-8">{children}</main>
          </SidebarInset>
        </SidebarProvider>
        <Toaster />
      </body>
    </html>
  );
}
