import {
  Building2,
  ClipboardList,
  FileText,
  LayoutDashboard,
  MoreHorizontal,
  Package,
  Settings,
  ShoppingCart,
  Ticket,
  Truck,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

// Las categorías reflejan los ítems de primer nivel del sidebar
// (src/shared/components/layout/_AppSidebar.tsx): navegación Principal,
// Configuración y secundaria. Mantener sincronizado con el sidebar.
export type CategorySlug =
  | 'dashboard'
  | 'empleados'
  | 'equipos'
  | 'documentos'
  | 'contabilidad'
  | 'comercial'
  | 'almacenes'
  | 'operaciones'
  | 'mantenimiento'
  | 'empresa'
  | 'sistema'
  | 'soporte'
  | 'otro';

export interface CategoryDef {
  slug: CategorySlug;
  label: string;
  icon: LucideIcon;
}

export const CATEGORIES: CategoryDef[] = [
  { slug: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { slug: 'empleados', label: 'Empleados', icon: Users },
  { slug: 'equipos', label: 'Equipos', icon: Truck },
  { slug: 'documentos', label: 'Documentos', icon: FileText },
  { slug: 'contabilidad', label: 'Contabilidad', icon: Wallet },
  { slug: 'comercial', label: 'Comercial', icon: ShoppingCart },
  { slug: 'almacenes', label: 'Almacenes', icon: Package },
  { slug: 'operaciones', label: 'Operaciones', icon: ClipboardList },
  { slug: 'mantenimiento', label: 'Mantenimiento', icon: Wrench },
  { slug: 'empresa', label: 'Empresa', icon: Building2 },
  { slug: 'otro', label: 'Otro', icon: MoreHorizontal },
];

export const CATEGORY_BY_SLUG: Record<CategorySlug, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c])
) as Record<CategorySlug, CategoryDef>;

const CATEGORY_BY_LABEL: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORIES.map((c) => [c.label, c])
);

const CATEGORY_PREFIX_RE = /^\[([^\]]+)\]\s*(.*)$/;

export function parseCategoryFromTitle(title: string): {
  categoryLabel: string | null;
  categoryDef: CategoryDef | null;
  cleanTitle: string;
} {
  const match = title.match(CATEGORY_PREFIX_RE);
  if (!match) return { categoryLabel: null, categoryDef: null, cleanTitle: title };
  const label = match[1];
  return {
    categoryLabel: label,
    categoryDef: CATEGORY_BY_LABEL[label] ?? null,
    cleanTitle: match[2] || title,
  };
}

export function buildTitleWithCategory(category: CategorySlug, rawTitle: string): string {
  const label = CATEGORY_BY_SLUG[category]?.label ?? 'Otro';
  return `[${label}] ${rawTitle.trim()}`;
}
