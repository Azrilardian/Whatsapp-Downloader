'use client';

import { usePathname } from 'next/navigation';
import { ConnectionIndicator } from '@/components/connection-indicator';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
} from '@/components/ui/sidebar';
import { NavItem } from './nav-item';
import type { SidebarNavProps } from './types';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/whitelists', label: 'Whitelists' },
  { href: '/activity', label: 'Activity' },
  { href: '/settings', label: 'Settings' },
];

export function SidebarNav(props: SidebarNavProps) {
  const { connectionStatus } = props;
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <div className="text-[15px] font-semibold tracking-tight">WA Downloader</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.href} href={item.href} label={item.label} isActive={pathname === item.href} />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border px-4 py-3">
        <ConnectionIndicator connectionStatus={connectionStatus} />
      </SidebarFooter>
    </Sidebar>
  );
}
