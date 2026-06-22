'use client';

import {
  BadgePercent,
  Building2,
  ChevronRight,
  ClipboardList,
  FileText,
  HelpCircle,
  LayoutDashboard,
  Package,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  ShoppingCart,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';

import type { CompanyListItem } from '@/modules/companies/features/list/actions.server';
import type { SidebarPermissions } from '@/shared/actions/sidebar';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/shared/components/ui/collapsible';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from '@/shared/components/ui/sidebar';
import type { Module } from '@/shared/lib/permissions';
import { _CompanyDisplay } from './_CompanyDisplay';
import { _CompanySelector } from './_CompanySelector';
import { _NavUser } from './nav/_NavUser';

// Tipos para navegación
interface NavItem {
  title: string;
  href: string;
  icon?: LucideIcon;
  disabled?: boolean;
  module?: Module | null; // null = siempre visible, sin módulo = siempre visible
}

interface NavSubGroup {
  title: string;
  icon: LucideIcon;
  items: NavItem[];
}

interface NavItemWithSub {
  title: string;
  href?: string;
  icon?: LucideIcon;
  disabled?: boolean;
  module?: Module | null;
  items?: NavItem[];
  subGroups?: NavSubGroup[];
}

// Navegación principal (con algunos subitems)
const navMain: NavItemWithSub[] = [
  { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, module: null },
  { title: 'Empleados', href: '/dashboard/employees', icon: Users, module: 'employees' },
  { title: 'Equipos', href: '/dashboard/equipment', icon: Truck, module: 'equipment' },
  { title: 'Documentos', href: '/dashboard/documents', icon: FileText, module: 'documents' },
  {
    title: 'Contabilidad',
    icon: Wallet,
    items: [
      { title: 'Dashboard', href: '/dashboard/accounting', module: 'accounting' },
      {
        title: 'Saldos de Apertura',
        href: '/dashboard/company/accounting/opening-balances',
        module: 'accounting.opening-balances',
      },
      {
        title: 'Asientos',
        href: '/dashboard/company/accounting/entries',
        module: 'accounting.entries',
      },
      {
        title: 'Presupuestos',
        href: '/dashboard/company/accounting/budgets',
        module: 'accounting.budgets',
      },
      {
        title: 'Informes',
        href: '/dashboard/company/accounting/reports',
        module: 'accounting.reports',
      },
      {
        title: 'Cierre Ejercicio',
        href: '/dashboard/company/accounting/fiscal-year-close',
        module: 'accounting.fiscal-year-close',
      },
      {
        title: 'Recurrentes',
        href: '/dashboard/company/accounting/recurring-entries',
        module: 'accounting.recurring-entries',
      },
    ],
  },
  {
    title: 'Comercial',
    icon: ShoppingCart,
    subGroups: [
      {
        title: 'Ventas',
        icon: TrendingUp,
        items: [
          {
            title: 'Clientes',
            href: '/dashboard/company/commercial/clients',
            module: 'commercial.clients',
          },
          {
            title: 'Leads',
            href: '/dashboard/company/commercial/leads',
            module: 'commercial.leads',
          },
          {
            title: 'Contactos',
            href: '/dashboard/company/commercial/contacts',
            module: 'commercial.contacts',
          },
          {
            title: 'Cotizaciones',
            href: '/dashboard/company/commercial/quotes',
            module: 'commercial.quotes',
          },
          {
            title: 'Puntos de Venta',
            href: '/dashboard/commercial/points-of-sale',
            module: 'commercial.points-of-sale',
          },
          {
            title: 'Remitos de Entrega',
            href: '/dashboard/commercial/delivery-notes',
            module: 'commercial.delivery-notes',
          },
          {
            title: 'Facturas de Venta',
            href: '/dashboard/commercial/invoices',
            module: 'commercial.invoices',
          },
          {
            title: 'Reportes de Ventas',
            href: '/dashboard/commercial/reports',
            module: 'commercial',
          },
          {
            title: 'Informes Impositivos',
            href: '/dashboard/commercial/reports/tax',
            module: 'commercial.invoices',
          },
        ],
      },
      {
        title: 'Compras',
        icon: ShoppingBag,
        items: [
          {
            title: 'Proveedores',
            href: '/dashboard/commercial/suppliers',
            module: 'commercial.suppliers',
          },
          {
            title: 'Órdenes de Compra',
            href: '/dashboard/commercial/purchase-orders',
            module: 'commercial.purchase-orders',
          },
          {
            title: 'Facturas de Compra',
            href: '/dashboard/commercial/purchases',
            module: 'commercial.purchases',
          },
          {
            title: 'Remitos de Recepción',
            href: '/dashboard/commercial/receiving-notes',
            module: 'commercial.receiving-notes',
          },
          {
            title: 'Reportes de Compras',
            href: '/dashboard/commercial/purchase-reports',
            module: 'commercial',
          },
          {
            title: 'Gastos',
            href: '/dashboard/commercial/expenses',
            module: 'commercial.expenses',
          },
        ],
      },
      {
        title: 'Tesorería',
        icon: Wallet,
        items: [
          {
            title: 'Flujo de Caja',
            href: '/dashboard/commercial/treasury/cashflow',
            module: 'commercial.treasury.cashflow',
          },
          {
            title: 'Cajas',
            href: '/dashboard/commercial/treasury/cash-registers',
            module: 'commercial.treasury.cash-registers',
          },
          {
            title: 'Cuentas',
            href: '/dashboard/commercial/treasury/bank-accounts',
            module: 'commercial.treasury.bank-accounts',
          },
          {
            title: 'Cheques',
            href: '/dashboard/commercial/treasury/checks',
            module: 'commercial.treasury.checks',
          },
          {
            title: 'Recibos de Cobro',
            href: '/dashboard/commercial/treasury/receipts',
            module: 'commercial.treasury.receipts',
          },
          {
            title: 'Órdenes de Pago',
            href: '/dashboard/commercial/treasury/payment-orders',
            module: 'commercial.treasury.payment-orders',
          },
          {
            title: 'Socios',
            href: '/dashboard/commercial/treasury/partners',
            module: 'commercial.treasury.partners',
          },
          {
            title: 'Tarjetas',
            href: '/dashboard/commercial/treasury/cards',
            module: 'commercial.treasury.cards',
          },
          {
            title: 'Cuotas de Tarjeta',
            href: '/dashboard/commercial/treasury/card-installments',
            module: 'commercial.treasury.cards',
          },
          {
            title: 'Retenciones',
            href: '/dashboard/commercial/treasury/withholdings',
            module: 'commercial.treasury.receipts',
          },
          {
            title: 'Proyecciones',
            href: '/dashboard/commercial/treasury/projections',
            module: 'commercial.treasury.projections',
          },
          {
            title: 'Saldos Pendientes',
            href: '/dashboard/commercial/account-balances',
            module: 'commercial',
          },
        ],
      },
    ],
  },
  {
    title: 'Almacenes',
    icon: Package,
    items: [
      {
        title: 'Almacenes',
        href: '/dashboard/commercial/warehouses',
        module: 'commercial.warehouses',
      },
      {
        title: 'Productos',
        href: '/dashboard/commercial/products',
        module: 'commercial.products',
      },
      {
        title: 'Listas de Precios',
        href: '/dashboard/commercial/price-lists',
        module: 'commercial.price-lists',
      },
      {
        title: 'Inventario',
        href: '/dashboard/commercial/stock',
        module: 'commercial.stock',
      },
      {
        title: 'Movimientos',
        href: '/dashboard/commercial/movements',
        module: 'commercial.movements',
      },
      {
        title: 'Equivalencias',
        href: '/dashboard/commercial/equivalences',
        module: 'commercial.equivalences',
      },
    ],
  },
  {
    title: 'Operaciones',
    href: '/dashboard/operations',
    icon: ClipboardList,
    disabled: true,
    module: null,
  },
  {
    title: 'Mantenimiento',
    href: '/dashboard/maintenance',
    icon: Wrench,
    disabled: true,
    module: null,
  },
];

// Configuración con subitems colapsables y subgrupos
const getNavConfig = (isSingleMode: boolean, activeCompanyId?: string): NavItemWithSub[] => [
  {
    title: 'Empresa',
    icon: Building2,
    subGroups: [
      {
        title: 'Administración',
        icon: Shield,
        items: [
          {
            title: 'Usuarios',
            href: '/dashboard/company/general/users',
            module: 'company.general.users',
          },
          {
            title: 'Roles',
            href: '/dashboard/company/general/roles',
            module: 'company.general.roles',
          },
          {
            title: 'Auditoría',
            href: '/dashboard/company/general/audit',
            module: 'company.general.audit',
          },
          {
            title: 'Módulos',
            href: '/dashboard/company/modules',
            module: 'company.general.users',
          },
        ],
      },
      {
        title: 'General',
        icon: Building2,
        items: [
          {
            title: isSingleMode ? 'Empresa' : 'Empresas',
            href:
              isSingleMode && activeCompanyId
                ? `/dashboard/companies/${activeCompanyId}`
                : '/dashboard/companies',
            module: null, // Siempre visible - el usuario necesita ver su empresa
          },
          {
            title: 'Centros de Costo',
            href: '/dashboard/company/cost-centers',
            module: 'company.cost-centers',
          },
          {
            title: 'Documentos',
            href: '/dashboard/company/documents',
            module: 'company.documents',
          },
          {
            title: 'Plantillas de PDF',
            href: '/dashboard/company/documents/templates',
            module: 'company.documents',
          },
          {
            title: 'Dashboard',
            href: '/dashboard/company/dashboard-settings',
            module: null, // Siempre visible - cada usuario configura su propio dashboard
          },
        ],
      },
      {
        title: 'RRHH',
        icon: Users,
        items: [
          {
            title: 'Tipos de Contrato',
            href: '/dashboard/company/contract-types',
            module: 'company.contract-types',
          },
          {
            title: 'Puestos de Trabajo',
            href: '/dashboard/company/job-positions',
            module: 'company.job-positions',
          },
          { title: 'Sindicatos', href: '/dashboard/company/unions', module: 'company.unions' },
          {
            title: 'Convenios',
            href: '/dashboard/company/collective-agreements',
            module: 'company.collective-agreements',
          },
          {
            title: 'Categorías',
            href: '/dashboard/company/job-categories',
            module: 'company.job-categories',
          },
        ],
      },
      {
        title: 'Equipos',
        icon: Truck,
        items: [
          {
            title: 'Marcas',
            href: '/dashboard/company/vehicle-brands',
            module: 'company.vehicle-brands',
          },
          {
            title: 'Tipos de Equipo',
            href: '/dashboard/company/vehicle-types',
            module: 'company.vehicle-types',
          },
          {
            title: 'Titulares',
            href: '/dashboard/company/equipment-owners',
            module: 'company.equipment-owners',
          },
          { title: 'Sectores', href: '/dashboard/company/sectors', module: 'company.sectors' },
          {
            title: 'Tipos Operativos',
            href: '/dashboard/company/type-operatives',
            module: 'company.type-operatives',
          },
          {
            title: 'Contratistas',
            href: '/dashboard/company/contractors',
            module: 'company.contractors',
          },
        ],
      },
      {
        title: 'Almacenes',
        icon: Package,
        items: [
          {
            title: 'Categorías',
            href: '/dashboard/commercial/categories',
            module: 'commercial.categories',
          },
        ],
      },
      {
        title: 'Comercial',
        icon: BadgePercent,
        items: [
          {
            title: 'Descuentos Predefinidos',
            href: '/dashboard/company/discount-presets',
            module: 'company.discount-presets',
          },
        ],
      },
      {
        title: 'Contabilidad',
        icon: Wallet,
        items: [
          {
            title: 'Plan de Cuentas',
            href: '/dashboard/company/accounting/accounts',
            module: 'accounting.accounts',
          },
          {
            title: 'Configuración',
            href: '/dashboard/company/accounting/settings',
            module: 'accounting.settings',
          },
        ],
      },
    ],
  },
  {
    title: 'Sistema',
    icon: Settings,
    items: [{ title: 'Configuración', href: '/dashboard/settings', disabled: true, module: null }],
  },
];

// Navegación secundaria
const navSecondary: NavItem[] = [
  { title: 'Ayuda', href: '/dashboard/help', icon: HelpCircle },
  { title: 'Buscar', href: '/dashboard/search', icon: Search, disabled: true },
];

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  companies: CompanyListItem[];
  activeCompany: CompanyListItem;
  isSingleMode?: boolean;
  permissions: SidebarPermissions;
}

export function _AppSidebar({
  companies,
  activeCompany,
  isSingleMode = false,
  permissions,
  ...props
}: AppSidebarProps) {
  const pathname = usePathname();
  const navConfig = getNavConfig(isSingleMode, activeCompany.id);

  const isActive = (href: string) => {
    if (href === '/dashboard') {
      return pathname === '/dashboard';
    }
    return pathname.startsWith(href);
  };

  // Determinar si algún subitem de un collapsible está activo
  const hasActiveSubItem = (items: NavItem[]) => {
    return items.some((item) => isActive(item.href));
  };

  // Determinar si algún item de los subgrupos está activo
  const hasActiveInSubGroups = (subGroups: NavSubGroup[]) => {
    return subGroups.some((group) => hasActiveSubItem(group.items));
  };

  // Determinar si un subgrupo tiene algún item activo
  const hasActiveInSubGroup = (subGroup: NavSubGroup) => {
    return hasActiveSubItem(subGroup.items);
  };

  // ========================================
  // Funciones de filtrado por permisos
  // ========================================

  // Verificar si puede ver un item
  const canViewItem = (item: NavItem): boolean => {
    // Items sin módulo (null o undefined) son siempre visibles
    if (item.module === null || item.module === undefined) return true;
    // Verificar permiso en el mapa
    return permissions[item.module] === true;
  };

  // Filtrar items que el usuario puede ver
  const filterItems = (items: NavItem[]): NavItem[] => {
    return items.filter(canViewItem);
  };

  // Filtrar items con subitems en navMain
  const filterNavMainItems = (items: NavItemWithSub[]): NavItemWithSub[] => {
    return items
      .map((item) => ({
        ...item,
        items: item.items ? filterItems(item.items) : undefined,
        subGroups: item.subGroups ? filterSubGroups(item.subGroups) : undefined,
      }))
      .filter((item) => {
        // Si tiene subGroups, debe tener al menos uno visible
        if (item.subGroups) {
          return item.subGroups.length > 0;
        }
        // Si tiene items, debe tener al menos uno visible
        if (item.items) {
          return item.items.length > 0;
        }
        // Si no tiene items ni subGroups, verificar si es visible directamente
        return item.href ? canViewItem(item as NavItem) : true;
      });
  };

  // Filtrar subgrupos - solo mostrar si tiene al menos un item visible
  const filterSubGroups = (subGroups: NavSubGroup[]): NavSubGroup[] => {
    return subGroups
      .map((group) => ({
        ...group,
        items: filterItems(group.items),
      }))
      .filter((group) => group.items.length > 0);
  };

  // Filtrar config - solo mostrar si tiene al menos un item/subgrupo visible
  const filterNavConfig = (config: NavItemWithSub[]): NavItemWithSub[] => {
    return config
      .map((item) => ({
        ...item,
        items: item.items ? filterItems(item.items) : undefined,
        subGroups: item.subGroups ? filterSubGroups(item.subGroups) : undefined,
      }))
      .filter((item) => (item.items?.length ?? 0) > 0 || (item.subGroups?.length ?? 0) > 0);
  };

  // Aplicar filtros
  const filteredNavMain = filterNavMainItems(navMain);
  const filteredNavConfig = filterNavConfig(navConfig);

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        {isSingleMode ? (
          <_CompanyDisplay company={activeCompany} />
        ) : (
          <_CompanySelector companies={companies} activeCompany={activeCompany} />
        )}
      </SidebarHeader>

      <SidebarContent>
        {/* Main Navigation - Solo mostrar si hay items */}
        {filteredNavMain.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Principal</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredNavMain.map((item) => (
                  <React.Fragment key={item.title}>
                    {/* Si tiene subitems simples, renderizar como collapsible */}
                    {item.items ? (
                      <Collapsible
                        asChild
                        defaultOpen={hasActiveSubItem(item.items)}
                        className="group/collapsible"
                      >
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton tooltip={item.title}>
                              {item.icon && <item.icon className="size-4" />}
                              <span>{item.title}</span>
                              <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {item.items.map((subItem) => (
                                <SidebarMenuSubItem key={subItem.href}>
                                  {subItem.disabled ? (
                                    <span className="flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground opacity-50 cursor-not-allowed text-sm">
                                      {subItem.title}
                                    </span>
                                  ) : (
                                    <SidebarMenuSubButton asChild isActive={isActive(subItem.href)}>
                                      <Link href={subItem.href}>
                                        <span>{subItem.title}</span>
                                      </Link>
                                    </SidebarMenuSubButton>
                                  )}
                                </SidebarMenuSubItem>
                              ))}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </SidebarMenuItem>
                      </Collapsible>
                    ) : item.subGroups ? (
                      /* Si tiene subgrupos, renderizar como collapsible con subgrupos anidados */
                      <Collapsible
                        asChild
                        defaultOpen={hasActiveInSubGroups(item.subGroups)}
                        className="group/collapsible"
                      >
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton tooltip={item.title}>
                              {item.icon && <item.icon className="size-4" />}
                              <span>{item.title}</span>
                              <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {item.subGroups.map((subGroup) => (
                                <Collapsible
                                  key={subGroup.title}
                                  asChild
                                  defaultOpen={hasActiveInSubGroup(subGroup)}
                                  className="group/subgroup"
                                >
                                  <SidebarMenuSubItem>
                                    <CollapsibleTrigger asChild>
                                      <SidebarMenuSubButton className="cursor-pointer font-medium">
                                        <subGroup.icon className="size-3.5" />
                                        <span>{subGroup.title}</span>
                                        <ChevronRight className="ml-auto size-3 transition-transform duration-200 group-data-[state=open]/subgroup:rotate-90" />
                                      </SidebarMenuSubButton>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                      <div className="ml-4 border-l pl-2 mt-1 space-y-0.5">
                                        {subGroup.items.map((subGroupItem) => (
                                          <SidebarMenuSubButton
                                            key={subGroupItem.href}
                                            asChild
                                            isActive={isActive(subGroupItem.href)}
                                            className="h-7"
                                          >
                                            {subGroupItem.disabled ? (
                                              <span className="flex items-center text-sidebar-foreground opacity-50 cursor-not-allowed">
                                                <span className="text-xs">{subGroupItem.title}</span>
                                              </span>
                                            ) : (
                                              <Link href={subGroupItem.href}>
                                                <span className="text-xs">{subGroupItem.title}</span>
                                              </Link>
                                            )}
                                          </SidebarMenuSubButton>
                                        ))}
                                      </div>
                                    </CollapsibleContent>
                                  </SidebarMenuSubItem>
                                </Collapsible>
                              ))}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </SidebarMenuItem>
                      </Collapsible>
                    ) : (
                      /* Si no tiene subitems ni subgrupos, renderizar como item simple */
                      <SidebarMenuItem>
                        {item.disabled ? (
                          <SidebarMenuButton
                            tooltip={`${item.title} (Próximamente)`}
                            disabled
                            className="opacity-50 cursor-not-allowed"
                          >
                            {item.icon && <item.icon className="size-4" />}
                            <span>{item.title}</span>
                          </SidebarMenuButton>
                        ) : (
                          <SidebarMenuButton
                            asChild
                            tooltip={item.title}
                            isActive={item.href ? isActive(item.href) : false}
                          >
                            <Link href={item.href!}>
                              {item.icon && <item.icon className="size-4" />}
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        )}
                      </SidebarMenuItem>
                    )}
                  </React.Fragment>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Configuration with Collapsible Items and SubGroups - Solo mostrar si hay items */}
        {filteredNavConfig.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Configuración</SidebarGroupLabel>
            <SidebarMenu>
              {filteredNavConfig.map((item) => (
                <Collapsible
                  key={item.title}
                  asChild
                  defaultOpen={
                    (item.items && hasActiveSubItem(item.items)) ||
                    (item.subGroups && hasActiveInSubGroups(item.subGroups))
                  }
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton tooltip={item.title}>
                        {item.icon && <item.icon className="size-4" />}
                        <span>{item.title}</span>
                        <ChevronRight className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {/* Renderizar items simples */}
                        {item.items?.map((subItem) => (
                          <SidebarMenuSubItem key={subItem.href}>
                            {subItem.disabled ? (
                              <span className="flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground opacity-50 cursor-not-allowed text-sm">
                                {subItem.title}
                              </span>
                            ) : (
                              <SidebarMenuSubButton asChild isActive={isActive(subItem.href)}>
                                <Link href={subItem.href}>
                                  <span>{subItem.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            )}
                          </SidebarMenuSubItem>
                        ))}

                        {/* Renderizar subgrupos colapsables */}
                        {item.subGroups?.map((subGroup) => (
                          <Collapsible
                            key={subGroup.title}
                            asChild
                            defaultOpen={hasActiveInSubGroup(subGroup)}
                            className="group/subgroup"
                          >
                            <SidebarMenuSubItem>
                              <CollapsibleTrigger asChild>
                                <SidebarMenuSubButton className="cursor-pointer font-medium">
                                  <subGroup.icon className="size-3.5" />
                                  <span>{subGroup.title}</span>
                                  <ChevronRight className="ml-auto size-3 transition-transform duration-200 group-data-[state=open]/subgroup:rotate-90" />
                                </SidebarMenuSubButton>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="ml-4 border-l pl-2 mt-1 space-y-0.5">
                                  {subGroup.items.map((subGroupItem) => (
                                    <SidebarMenuSubButton
                                      key={subGroupItem.href}
                                      asChild
                                      isActive={isActive(subGroupItem.href)}
                                      className="h-7"
                                    >
                                      <Link href={subGroupItem.href}>
                                        <span className="text-xs">{subGroupItem.title}</span>
                                      </Link>
                                    </SidebarMenuSubButton>
                                  ))}
                                </div>
                              </CollapsibleContent>
                            </SidebarMenuSubItem>
                          </Collapsible>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {/* Secondary Navigation */}
        <SidebarGroup className="mt-auto">
          <SidebarGroupContent>
            <SidebarMenu>
              {navSecondary.map((item) => (
                <SidebarMenuItem key={item.href}>
                  {item.disabled ? (
                    <SidebarMenuButton
                      tooltip={`${item.title} (Próximamente)`}
                      disabled
                      className="opacity-50 cursor-not-allowed"
                    >
                      {item.icon && <item.icon className="size-4" />}
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton asChild tooltip={item.title}>
                      <Link href={item.href}>
                        {item.icon && <item.icon className="size-4" />}
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <_NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
