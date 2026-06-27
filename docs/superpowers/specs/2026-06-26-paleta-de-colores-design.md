# Paleta de Colores (Azul) — Diseño

- **Tarea:** TSK-321 — Paleta de colores
- **Fecha:** 2026-06-26
- **Rama:** `feat/tsk-321-paleta-de-colores`

## Problema

La identidad visual de la app debe pasar a una paleta basada en **azul royal**
(`#2755ff`, derivado del color base `#0000ff`), replicando los mockups de
referencia adjuntos a la tarea: dashboard en claro y oscuro, y pantalla de
Control de Horas. Además del color de acento, los mockups cambian el sidebar de
"oscuro siempre" a **claro en modo claro / oscuro en modo oscuro**.

## Decisiones (acordadas)

1. **Fiel a los mockups**: azul `#2755ff` + sidebar que sigue el modo + fondos y
   cards acordes.
2. **Primario** = `#2755ff` (el de los mockups), no `#0000ff` literal.
3. **Charts**: se mantienen los colores variados actuales; solo `--chart-1` se
   alinea al azul nuevo.
4. **Único archivo**: `src/app/globals.css` (tokens OKLCH). Sin tocar
   componentes, salvo que alguno tenga color hardcodeado (ver Riesgos).

## Alcance

### Incluye
- Reasignar los tokens de color en `:root` (claro) y `.dark` (oscuro) de
  `src/app/globals.css` a la nueva paleta.
- Sidebar claro en modo claro (texto oscuro, item activo azul).

### No incluye (YAGNI)
- Rediseño de la escala de gráficos (`--chart-2..5` se conservan).
- Cambios de layout, tipografía o estructura de componentes.
- Modo de alto contraste u otros temas.

## Paleta objetivo

Valores muestreados de los mockups y convertidos a OKLCH (formato del archivo).
Hex de referencia entre paréntesis.

### Modo claro (`:root`)

| Token | Valor OKLCH | (hex ref) | Notas |
|---|---|---|---|
| `--primary` | `oklch(0.540 0.255 265.7)` | `#2755ff` | azul royal |
| `--primary-foreground` | `oklch(0.99 0 0)` | `#ffffff` | texto sobre azul |
| `--ring` | `oklch(0.488 0.289 264.1)` | `#0036ff` | foco de inputs (azul más puro) |
| `--background` | `oklch(0.975 0.004 301.4)` | `#f7f6f9` | gris frío muy claro |
| `--sidebar` | `oklch(1.000 0 0)` | `#ffffff` | **sidebar blanco** (antes oscuro) |
| `--sidebar-foreground` | `oklch(0.372 0.039 257.3)` | `#334155` | texto de items (oscuro) |
| `--sidebar-primary` | `oklch(0.540 0.255 265.7)` | `#2755ff` | item activo |
| `--sidebar-primary-foreground` | `oklch(0.99 0 0)` | `#ffffff` | texto del item activo |
| `--sidebar-accent` | `oklch(0.96 0.01 266)` | hover claro | hover de items |
| `--sidebar-accent-foreground` | `oklch(0.372 0.039 257.3)` | `#334155` | texto en hover |
| `--sidebar-border` | `oklch(0.92 0.006 286)` | borde sutil | separadores |
| `--sidebar-ring` | `oklch(0.540 0.255 265.7)` | `#2755ff` | |
| `--chart-1` | `oklch(0.540 0.255 265.7)` | `#2755ff` | alineado al azul |

### Modo oscuro (`.dark`)

| Token | Valor OKLCH | (hex ref) | Notas |
|---|---|---|---|
| `--primary` | `oklch(0.461 0.261 264.4)` | `#0736e6` | azul más profundo |
| `--primary-foreground` | `oklch(0.99 0 0)` | `#ffffff` | |
| `--ring` | `oklch(0.461 0.261 264.4)` | `#0736e6` | |
| `--background` | `oklch(0.302 0.031 276.6)` | `#2a2d3e` | azul-gris oscuro |
| `--card` | `oklch(0.339 0.035 277.7)` | `#33364a` | |
| `--sidebar` | `oklch(0.339 0.035 277.7)` | `#33364a` | |
| `--sidebar-primary` | `oklch(0.540 0.255 265.7)` | `#2755ff` | item activo |
| `--chart-1` | `oklch(0.461 0.261 264.4)` | `#0736e6` | |

> Los demás tokens (`--foreground`, `--muted`, `--border`, `--secondary`,
> `--accent`, `--destructive`, `--chart-2..5`, etc.) se conservan, ajustando solo
> donde el contraste con los nuevos fondos lo requiera (p. ej. `--foreground` /
> `--muted-foreground` para legibilidad sobre `#f7f6f9` y `#2a2d3e`).

## Riesgos / verificación de implementación

- **Sidebar pasa de oscuro a claro:** el componente de sidebar y sus hijos
  (`_AppSidebar`, `_CompanySelector`, `_NavUser`, etc.) deben consumir las
  variables `--sidebar-*` y no colores hardcodeados (`bg-slate-900`, `text-white`,
  etc.). Durante la implementación se hace un grep de clases de color fijas en
  `src/shared/components/layout/` y, si las hay, se reemplazan por los tokens.
- **Contraste:** verificar legibilidad del texto del sidebar y de las cards en
  ambos modos (texto oscuro sobre sidebar blanco; texto claro sobre `#2a2d3e`).

## Pruebas

Verificación **manual visual** (no hay tests de UI en el repo): levantar la app
(`npm run dev`) y comparar contra los 3 mockups de la tarea:

1. **Dashboard claro** — sidebar blanco, item activo azul, cards blancas, fondo
   `#f7f6f9`.
2. **Dashboard oscuro** — fondo `#2a2d3e`, cards `#33364a`, item activo azul.
3. **Control de Horas (claro)** — tabs con texto/subrayado azul, input en foco con
   borde azul, botones circulares con borde azul.

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/app/globals.css` | Reasignar tokens de color en `:root` y `.dark` |
| `src/shared/components/layout/*` | Solo si hay colores hardcodeados (verificación) |
