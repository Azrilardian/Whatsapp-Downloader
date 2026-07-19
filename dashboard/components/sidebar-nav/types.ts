import type { ConnectionStatus } from '@wadl/shared';

export interface SidebarNavProps {
  connectionStatus: ConnectionStatus | null;
}

export interface NavItemProps {
  href: string;
  label: string;
  isActive: boolean;
}
