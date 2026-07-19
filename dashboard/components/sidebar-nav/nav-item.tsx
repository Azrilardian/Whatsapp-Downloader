import Link from 'next/link';
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import type { NavItemProps } from './types';

export function NavItem(props: NavItemProps) {
  const { href, label, isActive } = props;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive}>
        <Link href={href}>{label}</Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
