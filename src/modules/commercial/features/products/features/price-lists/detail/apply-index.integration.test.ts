/**
 * Tests de integración de la aplicación de índices a listas de precios
 * (TSK-621) contra la base real de desarrollo.
 *
 * Hasta esta tarea, `adjustItems`/`adjustItem`/`applyPercentage`/
 * `findPreviousApplication` (price-index-calc.ts) ya tenían 14 tests
 * unitarios, y `getApplicablePriceIndexes`/`previewPriceIndexApplication`/
 * `applyPriceIndexToList`/`getPriceListAdjustments` (apply-index.server.ts)
 * se venían verificando con scripts de Prisma temporales que se borraban al
 * terminar. Nada en el repo detectaba una regresión en la aplicación real de
 * un índice contra la base. Este archivo es la red de seguridad permanente.
 *
 * Molde seguido: `src/modules/accounting/features/integrations/commercial/
 * cost-center.integration.test.ts` — `describe.skipIf` cuando la base no
 * está disponible, datos con prefijo propio, limpieza completa en el
 * `afterAll`.
 *
 * Server Actions no invocables desde el test: `applyPriceIndexToList` (y el
 * resto de apply-index.server.ts) empieza con `checkPermission()` →
 * `getActiveCompanyId()` → `getCurrentUserId()`, que llaman a
 * `next/headers` (`headers()`). Esa función tira fuera de un request real de
 * Next, así que no se puede invocar el Server Action tal cual desde Vitest.
 *
 * Camino elegido (igual que el caso 5 del molde): replicar en
 * `replicateApplyPriceIndex()` de más abajo la MISMA secuencia de consultas
 * y la MISMA lógica que hace `applyPriceIndexToList` — mismo `select` de
 * `getItemsForAdjustment`, misma llamada a `adjustItems` (función pura real,
 * sin reimplementar), misma forma de la transacción (actualizar ítems,
 * actualizar `lastModifiedBy` de la lista, crear el `PriceListAdjustment`) —
 * pero sin `checkPermission`/`getActiveCompanyId`/`getCurrentUserId`.
 *
 * Qué protege: que esa secuencia de consultas + `adjustItems`, ejecutada
 * contra la base real, deja los precios y el historial correctos, y que la
 * transacción es atómica de verdad. Qué NO protege: que
 * `applyPriceIndexToList` siga llamando a esta misma secuencia. Si alguien
 * cambia el `select`, el orden de las escrituras dentro de la transacción, o
 * deja de usar `adjustItems` en el Server Action real sin tocar
 * `price-index-calc.ts`, este test sigue en verde y no lo detecta.
 *
 * Aislamiento de datos: todo lo que este archivo crea usa el prefijo
 * `TSK621-TEST-` (empresa, índice, productos, listas de precios). El
 * `afterAll` borra todo en orden inverso de dependencias y verifica que no
 * sobrevive ninguna fila con el prefijo. No se toca ninguna empresa,
 * producto ni lista existente.
 *
 * Disponibilidad de la base: si Docker no está levantado, todo el archivo se
 * saltea con `describe.skipIf` (no falla) — así `npm test` sigue en verde
 * para quien no tenga la base local arriba. Ver el chequeo de conectividad
 * más abajo.
 */
import 'dotenv/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/shared/lib/prisma';
import { adjustItems, findPreviousApplication } from '../shared/price-index-calc';

const PREFIX = 'TSK621-TEST-';
const FAKE_USER_ID = `${PREFIX}usuario`;
// UUID sintácticamente válido pero que no existe en `price_indexes`: sirve
// para forzar el fallo de una FK en la ÚLTIMA escritura de la transacción
// (ver caso 3, atomicidad).
const NONEXISTENT_INDEX_ID = '00000000-0000-0000-0000-000000000000';

// ============================================
// Chequeo de disponibilidad de la base
// ============================================
let dbAvailable = false;
try {
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

/**
 * Replica la secuencia de `applyPriceIndexToList`
 * (`apply-index.server.ts`), sin el `checkPermission`/`getActiveCompanyId`/
 * `getCurrentUserId` que impiden invocar el Server Action fuera de un
 * request. Ver comentario de cabecera del archivo.
 *
 * `forceInvalidIndexId`: cuando es `true`, la creación del
 * `PriceListAdjustment` (la última escritura de la transacción) usa un
 * `indexId` inexistente, lo que dispara una violación de FK real después de
 * que las actualizaciones de los ítems ya se ejecutaron dentro de la misma
 * transacción. Así se fuerza un fallo real a mitad de camino, no uno
 * simulado.
 */
async function replicateApplyPriceIndex(
  priceListId: string,
  indexValueId: string,
  options: { forceInvalidIndexId?: boolean } = {}
) {
  const indexValue = await prisma.priceIndexValue.findFirst({
    where: { id: indexValueId },
    select: { id: true, indexId: true, percentage: true },
  });
  if (!indexValue) {
    throw new Error('Valor de índice no encontrado');
  }

  const rawItems = await prisma.priceListItem.findMany({
    where: { priceListId },
    select: {
      id: true,
      price: true,
      product: { select: { name: true, vatRate: true } },
    },
    orderBy: { product: { name: 'asc' } },
  });

  const percentage = Number(indexValue.percentage);
  const adjustableItems = rawItems.map((item) => ({
    id: item.id,
    price: Number(item.price),
    vatRate: Number(item.product.vatRate),
  }));
  const adjusted = adjustItems(adjustableItems, percentage);

  return prisma.$transaction(async (tx) => {
    await Promise.all(
      adjusted.map((item) =>
        tx.priceListItem.update({
          where: { id: item.id },
          data: { price: item.price, priceWithTax: item.priceWithTax, updatedBy: FAKE_USER_ID },
        })
      )
    );

    await tx.priceList.update({
      where: { id: priceListId },
      data: { lastModifiedBy: FAKE_USER_ID },
    });

    return tx.priceListAdjustment.create({
      data: {
        priceListId,
        indexId: options.forceInvalidIndexId ? NONEXISTENT_INDEX_ID : indexValue.indexId,
        indexValueId,
        percentage: indexValue.percentage,
        itemsAffected: adjusted.length,
        appliedBy: FAKE_USER_ID,
      },
      select: { percentage: true, itemsAffected: true, appliedAt: true },
    });
  });
}

describe.skipIf(!dbAvailable)('integración: aplicación de índices a listas de precios (TSK-621)', () => {
  let companyId: string;
  let indexId: string;
  let indexValue10Id: string;

  let product21Id: string;
  let product105Id: string;
  let product0Id: string;

  const createdPriceListIds: string[] = [];

  beforeAll(async () => {
    const company = await prisma.company.create({
      data: { name: `${PREFIX}Empresa`, isActive: true },
    });
    companyId = company.id;

    const index = await prisma.priceIndex.create({
      data: { companyId, name: `${PREFIX}Indice`, isActive: true },
    });
    indexId = index.id;

    const indexValue10 = await prisma.priceIndexValue.create({
      data: { indexId, period: new Date('2026-01-01'), percentage: 10 },
    });
    indexValue10Id = indexValue10.id;

    const [product21, product105, product0] = await Promise.all([
      prisma.product.create({
        data: {
          companyId,
          code: `${PREFIX}PROD-21`,
          name: `${PREFIX}Producto IVA 21`,
          vatRate: 21,
          createdBy: 'test',
        },
      }),
      prisma.product.create({
        data: {
          companyId,
          code: `${PREFIX}PROD-105`,
          name: `${PREFIX}Producto IVA 10.5`,
          vatRate: 10.5,
          createdBy: 'test',
        },
      }),
      prisma.product.create({
        data: {
          companyId,
          code: `${PREFIX}PROD-0`,
          name: `${PREFIX}Producto IVA 0`,
          vatRate: 0,
          createdBy: 'test',
        },
      }),
    ]);
    product21Id = product21.id;
    product105Id = product105.id;
    product0Id = product0.id;
  });

  afterAll(async () => {
    // Orden inverso de dependencias: las listas cascadean sus ítems y sus
    // ajustes; el índice cascadea sus valores; después productos y empresa.
    for (const id of createdPriceListIds) {
      await prisma.priceList.delete({ where: { id } }).catch(() => undefined);
    }
    await prisma.priceIndex.deleteMany({ where: { companyId } });
    await prisma.product.deleteMany({ where: { companyId } });
    await prisma.company.deleteMany({ where: { id: companyId } });

    // Verificación de que no sobrevive ninguna fila de la corrida.
    const [remainingIndexes, remainingProducts, remainingCompanies, remainingPriceLists] = await Promise.all([
      prisma.priceIndex.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.product.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.company.count({ where: { name: { startsWith: PREFIX } } }),
      prisma.priceList.count({ where: { name: { startsWith: PREFIX } } }),
    ]);
    expect(remainingIndexes).toBe(0);
    expect(remainingProducts).toBe(0);
    expect(remainingCompanies).toBe(0);
    expect(remainingPriceLists).toBe(0);

    await prisma.$disconnect();
  });

  describe('caso 1 y 2: aplicación completa deja los precios ajustados y una fila de historial', () => {
    let priceListId: string;
    let result: Awaited<ReturnType<typeof replicateApplyPriceIndex>>;

    beforeAll(async () => {
      const priceList = await prisma.priceList.create({
        data: { companyId, name: `${PREFIX}Lista Aplicacion Completa` },
      });
      priceListId = priceList.id;
      createdPriceListIds.push(priceListId);

      await prisma.priceListItem.createMany({
        data: [
          { priceListId, productId: product21Id, price: 1000, priceWithTax: 1210 },
          { priceListId, productId: product105Id, price: 2000, priceWithTax: 2210 },
          { priceListId, productId: product0Id, price: 500, priceWithTax: 500 },
        ],
      });

      result = await replicateApplyPriceIndex(priceListId, indexValue10Id);
    });

    it('sube el precio de los tres ítems un 10% y recalcula priceWithTax con el IVA de cada uno', async () => {
      const items = await prisma.priceListItem.findMany({
        where: { priceListId },
        select: { productId: true, price: true, priceWithTax: true },
      });
      const byProduct = new Map(
        items.map((i) => [i.productId, { price: Number(i.price), priceWithTax: Number(i.priceWithTax) }])
      );

      // 1000 * 1.10 = 1100; 1100 * 1.21 = 1331
      expect(byProduct.get(product21Id)).toEqual({ price: 1100, priceWithTax: 1331 });
      // 2000 * 1.10 = 2200; 2200 * 1.105 = 2431
      expect(byProduct.get(product105Id)).toEqual({ price: 2200, priceWithTax: 2431 });
      // 500 * 1.10 = 550; 550 * 1 = 550
      expect(byProduct.get(product0Id)).toEqual({ price: 550, priceWithTax: 550 });
    });

    it('registra en el historial el porcentaje aplicado y los 3 ítems afectados', () => {
      expect(Number(result.percentage)).toBe(10);
      expect(result.itemsAffected).toBe(3);
    });

    it('la fila de price_list_adjustments queda persistida con esos mismos valores', async () => {
      const adjustments = await prisma.priceListAdjustment.findMany({
        where: { priceListId },
        select: { percentage: true, itemsAffected: true, indexId: true, indexValueId: true },
      });

      expect(adjustments).toHaveLength(1);
      expect(Number(adjustments[0].percentage)).toBe(10);
      expect(adjustments[0].itemsAffected).toBe(3);
      expect(adjustments[0].indexId).toBe(indexId);
      expect(adjustments[0].indexValueId).toBe(indexValue10Id);
    });
  });

  describe('caso 3: atomicidad — si la ultima escritura de la transaccion falla, ningun precio queda modificado', () => {
    let priceListId: string;
    let itemAId: string;
    let itemBId: string;

    beforeAll(async () => {
      const priceList = await prisma.priceList.create({
        data: { companyId, name: `${PREFIX}Lista Atomicidad` },
      });
      priceListId = priceList.id;
      createdPriceListIds.push(priceListId);

      const [itemA, itemB] = await Promise.all([
        prisma.priceListItem.create({
          data: { priceListId, productId: product21Id, price: 1000, priceWithTax: 1210 },
        }),
        prisma.priceListItem.create({
          data: { priceListId, productId: product105Id, price: 2000, priceWithTax: 2210 },
        }),
      ]);
      itemAId = itemA.id;
      itemBId = itemB.id;
    });

    it('la aplicacion falla y ningun item de la lista queda modificado', async () => {
      // `forceInvalidIndexId` hace que la creación del PriceListAdjustment
      // (última escritura de la transacción) intente un indexId que no
      // existe: viola la FK después de que los updates de los ítems ya se
      // ejecutaron dentro de la misma transacción. Si `$transaction` no
      // hiciera rollback, los precios de abajo habrían quedado en 1100/2200.
      await expect(replicateApplyPriceIndex(priceListId, indexValue10Id, { forceInvalidIndexId: true })).rejects.toThrow();

      const items = await prisma.priceListItem.findMany({
        where: { priceListId },
        select: { id: true, price: true, priceWithTax: true },
      });
      const byId = new Map(items.map((i) => [i.id, { price: Number(i.price), priceWithTax: Number(i.priceWithTax) }]));

      expect(byId.get(itemAId)).toEqual({ price: 1000, priceWithTax: 1210 });
      expect(byId.get(itemBId)).toEqual({ price: 2000, priceWithTax: 2210 });

      const adjustments = await prisma.priceListAdjustment.count({ where: { priceListId } });
      expect(adjustments).toBe(0);

      const list = await prisma.priceList.findUniqueOrThrow({
        where: { id: priceListId },
        select: { lastModifiedBy: true },
      });
      expect(list.lastModifiedBy).toBeNull();
    });
  });

  describe('caso 4: aplicar el mismo valor de indice dos veces deja dos filas en el historial', () => {
    let priceListId: string;

    beforeAll(async () => {
      const priceList = await prisma.priceList.create({
        data: { companyId, name: `${PREFIX}Lista Doble Aplicacion` },
      });
      priceListId = priceList.id;
      createdPriceListIds.push(priceListId);

      await prisma.priceListItem.create({
        data: { priceListId, productId: product21Id, price: 1000, priceWithTax: 1210 },
      });

      await replicateApplyPriceIndex(priceListId, indexValue10Id);
      // Separación real entre las dos aplicaciones para que `appliedAt`
      // (con default `now()`) quede en instantes distinguibles, sin
      // hardcodear la fecha: se ejercita el timestamp real que persiste la
      // base, no uno inventado por el test.
      await new Promise((resolve) => setTimeout(resolve, 20));
      await replicateApplyPriceIndex(priceListId, indexValue10Id);
    });

    it('deja dos filas de historial para el mismo valor de indice', async () => {
      const adjustments = await prisma.priceListAdjustment.count({
        where: { priceListId, indexValueId: indexValue10Id },
      });
      expect(adjustments).toBe(2);
    });

    it('findPreviousApplication, sobre el historial real, encuentra la mas reciente', async () => {
      const history = await prisma.priceListAdjustment.findMany({
        where: { priceListId },
        select: { indexId: true, indexValueId: true, appliedAt: true, appliedBy: true },
      });
      expect(history).toHaveLength(2);

      const sorted = [...history].sort((a, b) => a.appliedAt.getTime() - b.appliedAt.getTime());
      const previous = findPreviousApplication(history, indexValue10Id);

      expect(previous).not.toBeNull();
      expect(previous?.appliedAt.getTime()).toBe(sorted[1].appliedAt.getTime());
    });
  });
});
