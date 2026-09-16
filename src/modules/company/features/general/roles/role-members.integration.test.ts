/**
 * Tests de integración de `getRolesPaginated` con los miembros de cada rol
 * (TSK-692: "ver quién tiene qué rol"), contra la base real.
 *
 * Sigue el criterio de `purchase-invoice-tributes.integration.test.ts`: se
 * aísla ÚNICAMENTE la frontera de sesión/permisos/empresa activa/caché de
 * Next (los cuatro `vi.mock` de abajo). La query de roles, el filtro de
 * miembros activos, el enriquecimiento en lote con `User` y el cálculo de
 * `inactiveMembersCount` son el código real de producción.
 *
 * Lo que se verifica:
 * - `members` trae SOLO los activos, con email/firstName/lastName/imageUrl
 *   del `User` y con `isOwner`, owner primero.
 * - `_count.members` sigue contando activos + inactivos (lo usan la regla de
 *   eliminar en `columns.tsx` y `deleteRole`): NO cambia de semántica.
 * - `inactiveMembersCount` = `_count.members - members.length`.
 * - Un miembro cuyo `userId` no existe en `User` recibe el mismo fallback que
 *   la pantalla de Usuarios ('Sin email', '', '', null).
 * - Los usuarios de TODA la página se resuelven con un único
 *   `prisma.user.findMany`.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { prisma } from '@/shared/lib/prisma';

// Frontera aislada: sesión, permisos, empresa activa y caché de Next.
// `roles/actions.server.ts` importa además constantes (MODULES, ACTIONS,
// AUDIT_ACTIONS) y `createAuditLog` de `@/shared/lib/permissions`, por eso el
// mock conserva el módulo original y solo reemplaza `checkPermission`.
vi.mock('@/shared/lib/current-user', () => ({ getCurrentUserId: vi.fn() }));
vi.mock('@/shared/lib/company', () => ({ getActiveCompanyId: vi.fn() }));
vi.mock('@/shared/lib/permissions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/lib/permissions')>()),
  checkPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { getActiveCompanyId } from '@/shared/lib/company';
import { getCurrentUserId } from '@/shared/lib/current-user';

// Código real de producción.
import { getRolesPaginated } from './actions.server';

const PREFIX = 'TSK692-';

let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

type RolesPage = Awaited<ReturnType<typeof getRolesPaginated>>;

describe.skipIf(!dbAvailable)('integración: getRolesPaginated devuelve los miembros de cada rol (TSK-692)', () => {
  let companyId: string;
  let rolConUnoId: string;
  let rolMixtoId: string;
  let rolVacioId: string;
  let rolHuerfanoId: string;
  let ownerUserId: string;
  let activoUserId: string;
  let inactivoUserId: string;
  const orphanUserId = randomUUID();

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const [owner, activo, inactivo] = await Promise.all([
      prisma.user.create({
        data: {
          email: `${PREFIX}owner@test.local`,
          name: 'Elizabeth Perez',
          firstName: 'Elizabeth',
          lastName: 'Perez',
          imageUrl: 'https://example.test/eli.png',
        },
      }),
      prisma.user.create({
        data: {
          email: `${PREFIX}activo@test.local`,
          name: 'Juan Activo',
          firstName: 'Juan',
          lastName: 'Activo',
        },
      }),
      prisma.user.create({
        data: {
          email: `${PREFIX}inactivo@test.local`,
          name: 'Marta Inactiva',
          firstName: 'Marta',
          lastName: 'Inactiva',
        },
      }),
    ]);
    ownerUserId = owner.id;
    activoUserId = activo.id;
    inactivoUserId = inactivo.id;

    const mkRole = (name: string, slug: string) =>
      prisma.companyRole.create({
        data: { companyId, name: `${PREFIX}${name}`, slug: `${PREFIX}${slug}`, isSystem: false },
      });

    const [rolConUno, rolMixto, rolVacio, rolHuerfano] = await Promise.all([
      mkRole('Con uno', 'con-uno'),
      mkRole('Mixto', 'mixto'),
      mkRole('Vacio', 'vacio'),
      mkRole('Huerfano', 'huerfano'),
    ]);
    rolConUnoId = rolConUno.id;
    rolMixtoId = rolMixto.id;
    rolVacioId = rolVacio.id;
    rolHuerfanoId = rolHuerfano.id;

    // rolConUno: 1 activo owner.
    await prisma.companyMember.create({
      data: { companyId, userId: ownerUserId, roleId: rolConUnoId, isOwner: true, isActive: true },
    });
    // rolMixto: 1 activo + 1 inactivo (lo que deja `deactivateMember`: isActive=false, conserva roleId).
    await prisma.companyMember.create({
      data: { companyId, userId: activoUserId, roleId: rolMixtoId, isOwner: false, isActive: true },
    });
    await prisma.companyMember.create({
      data: { companyId, userId: inactivoUserId, roleId: rolMixtoId, isOwner: false, isActive: false },
    });
    // rolHuerfano: 1 activo cuyo userId no existe en User (cubre el fallback).
    await prisma.companyMember.create({
      data: { companyId, userId: orphanUserId, roleId: rolHuerfanoId, isOwner: false, isActive: true },
    });

    vi.mocked(getActiveCompanyId).mockResolvedValue(companyId);
    vi.mocked(getCurrentUserId).mockResolvedValue(ownerUserId);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.companyMember.deleteMany({ where: { companyId } });
    await prisma.companyRole.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });
    await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });

    const remaining = await prisma.company.count({ where: { name: { startsWith: PREFIX } } });
    expect(remaining).toBe(0);

    await prisma.$disconnect();
  });

  const findRole = (page: RolesPage, id: string) => {
    const role = page.data.find((r) => r.id === id);
    if (!role) throw new Error(`Rol ${id} no vino en la página`);
    return role;
  };

  it('un rol con un owner activo trae ese miembro enriquecido con los datos del User', async () => {
    const page = await getRolesPaginated({});
    const role = findRole(page, rolConUnoId);

    expect(role.members).toHaveLength(1);
    expect(role.members[0]).toMatchObject({
      userId: ownerUserId,
      isOwner: true,
      email: `${PREFIX}owner@test.local`,
      firstName: 'Elizabeth',
      lastName: 'Perez',
      imageUrl: 'https://example.test/eli.png',
    });
    expect(role._count.members).toBe(1);
    expect(role.inactiveMembersCount).toBe(0);
  });

  it('un rol con un activo y un inactivo lista solo el activo, pero _count.members sigue contando a los dos', async () => {
    const page = await getRolesPaginated({});
    const role = findRole(page, rolMixtoId);

    expect(role.members).toHaveLength(1);
    expect(role.members[0]).toMatchObject({
      userId: activoUserId,
      isOwner: false,
      email: `${PREFIX}activo@test.local`,
      firstName: 'Juan',
      lastName: 'Activo',
      imageUrl: null,
    });
    expect(role.members.some((m) => m.userId === inactivoUserId)).toBe(false);
    // Semántica intacta: la regla de eliminar y deleteRole leen este total sin filtrar.
    expect(role._count.members).toBe(2);
    expect(role.inactiveMembersCount).toBe(1);
  });

  it('un rol sin miembros devuelve members vacío y contadores en cero', async () => {
    const page = await getRolesPaginated({});
    const role = findRole(page, rolVacioId);

    expect(role.members).toEqual([]);
    expect(role._count.members).toBe(0);
    expect(role.inactiveMembersCount).toBe(0);
  });

  it('un miembro cuyo userId no existe en User recibe el mismo fallback que la pantalla de Usuarios', async () => {
    const page = await getRolesPaginated({});
    const role = findRole(page, rolHuerfanoId);

    expect(role.members).toHaveLength(1);
    expect(role.members[0]).toMatchObject({
      userId: orphanUserId,
      isOwner: false,
      email: 'Sin email',
      firstName: '',
      lastName: '',
      imageUrl: null,
    });
    expect(role._count.members).toBe(1);
    expect(role.inactiveMembersCount).toBe(0);
  });

  it('resuelve los usuarios de toda la página con un único prisma.user.findMany', async () => {
    const spy = vi.spyOn(prisma.user, 'findMany');

    const page = await getRolesPaginated({});

    // La página tiene varios roles con miembros (conUno, mixto, huerfano) y aun así un solo lote.
    expect(page.data.filter((r) => r.members.length > 0).length).toBeGreaterThanOrEqual(3);
    expect(spy).toHaveBeenCalledTimes(1);

    const call = spy.mock.calls[0]?.[0];
    const requested = call?.where?.id;
    expect(requested).toBeDefined();
    expect(requested && typeof requested === 'object' && 'in' in requested ? requested.in : undefined).toEqual(
      expect.arrayContaining([ownerUserId, activoUserId, orphanUserId])
    );
  });

  it('el owner aparece primero en members cuando el rol tiene owner y no-owner', async () => {
    // Sumo un no-owner al rol del owner, creado ANTES en el orden natural para que el
    // orden por isOwner sea lo que lo pone primero y no el createdAt.
    const extraUser = await prisma.user.create({
      data: {
        email: `${PREFIX}segundo@test.local`,
        name: 'Ana Segunda',
        firstName: 'Ana',
        lastName: 'Segunda',
      },
    });
    const extraMember = await prisma.companyMember.create({
      data: {
        companyId,
        userId: extraUser.id,
        roleId: rolConUnoId,
        isOwner: false,
        isActive: true,
        createdAt: new Date('2020-01-01T00:00:00Z'),
      },
    });

    try {
      const page = await getRolesPaginated({});
      const role = findRole(page, rolConUnoId);

      expect(role.members.map((m) => m.userId)).toEqual([ownerUserId, extraUser.id]);
      expect(role.members[0].isOwner).toBe(true);
      expect(role._count.members).toBe(2);
      expect(role.inactiveMembersCount).toBe(0);
    } finally {
      await prisma.companyMember.delete({ where: { id: extraMember.id } });
      await prisma.user.delete({ where: { id: extraUser.id } });
    }
  });
});
