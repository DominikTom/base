'use client';

import {
  Baby,
  BedDouble,
  BriefcaseBusiness,
  DoorOpen,
  Gamepad2,
  House,
  Shirt,
  Sofa,
  Warehouse,
} from 'lucide-react';

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'bed-double': BedDouble,
  sofa: Sofa,
  baby: Baby,
  'gamepad-2': Gamepad2,
  'briefcase-business': BriefcaseBusiness,
  shirt: Shirt,
  'door-open': DoorOpen,
  warehouse: Warehouse,
};

export function RoomIcon({ icon, className }: { icon: string | null; className?: string }) {
  const Icon = (icon && ICONS[icon]) || House;
  return <Icon className={className} />;
}
