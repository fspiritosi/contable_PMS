# Paleta de Colores (Azul) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reasignar los tokens de color de `src/app/globals.css` a una paleta basada en azul royal `#2755ff`, con sidebar claro en modo claro / oscuro en modo oscuro, fiel a los mockups de TSK-321.

**Architecture:** Solo se editan las variables CSS de `:root` (claro) y `.dark` (oscuro) en `src/app/globals.css`. Los componentes consumen esas variables (verificado: el sidebar de shadcn usa `bg-sidebar`/`text-sidebar-foreground`, sin colores hardcodeados en `src/shared/components/layout/`), así que no se tocan componentes.

**Tech Stack:** Tailwind CSS v4 (`@theme inline`), shadcn/ui, formato de color OKLCH.

## Global Constraints

- **Único archivo a editar:** `src/app/globals.css`. No tocar componentes salvo que aparezca un color hardcodeado (no se encontró ninguno).
- **Primario:** azul royal `#2755ff` → `oklch(0.540 0.255 266)` (claro). En oscuro `#0736e6` → `oklch(0.461 0.261 264)`.
- **Foco de inputs (`--ring`) en claro:** `#0036ff` → `oklch(0.488 0.289 264)`.
- **Sidebar claro = blanco** en modo claro; texto de items `#334155` → `oklch(0.372 0.039 257)`. En oscuro, `#33364a` → `oklch(0.339 0.035 278)`.
- **Fondos:** claro `#f7f6f9` → `oklch(0.975 0.004 301)`; oscuro `#2a2d3e` → `oklch(0.302 0.031 277)`; card oscuro `#33364a` → `oklch(0.339 0.035 278)`.
- **Charts:** solo `--chart-1` pasa a azul; `--chart-2..5` se conservan.
- **No** hay tests automatizados de UI; la verificación es **visual** contra los 3 mockups (claro, oscuro, Control de Horas) descargados en el scratchpad de la sesión.
- Commits terminan con: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

| Archivo | Cambio |
|---|---|
| `src/app/globals.css` | Reasignar tokens en `:root` (Task 1) y `.dark` (Task 2); ajustar el gradiente del `body` (Task 1) |

---

## Task 1: Modo claro (`:root`) + atmósfera del `body`

**Files:**
- Modify: `src/app/globals.css:59-109` (bloque `:root`), `:167-169` (gradiente del `body`)

**Interfaces:**
- Produces: tokens de color de modo claro con la nueva paleta azul; sidebar blanco.

- [ ] **Step 1: Reemplazar el bloque `:root` completo**

Reemplazar el bloque actual `:root { ... }` (líneas 59-109) por:

```css
:root {
  --radius: 0.7rem;

  /* Superficies y texto */
  --background: oklch(0.975 0.004 301); /* #f7f6f9 */
  --foreground: oklch(0.22 0.02 250);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.22 0.02 250);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.22 0.02 250);

  /* Marca — azul royal #2755ff */
  --primary: oklch(0.540 0.255 266);
  --primary-foreground: oklch(0.99 0 0);

  --secondary: oklch(0.965 0.008 266);
  --secondary-foreground: oklch(0.28 0.02 266);
  --muted: oklch(0.965 0.008 266);
  --muted-foreground: oklch(0.52 0.02 266);
  --accent: oklch(0.95 0.03 266);
  --accent-foreground: oklch(0.34 0.09 266);

  /* Semánticos */
  --destructive: oklch(0.58 0.21 25);
  --destructive-foreground: oklch(0.99 0 0);
  --success: oklch(0.62 0.15 152);
  --success-foreground: oklch(0.99 0 0);
  --warning: oklch(0.74 0.14 78);
  --warning-foreground: oklch(0.28 0.05 80);

  --border: oklch(0.91 0.01 266);
  --input: oklch(0.91 0.01 266);
  --ring: oklch(0.488 0.289 264); /* #0036ff foco */

  /* Charts — chart-1 azul, resto conservado */
  --chart-1: oklch(0.540 0.255 266);
  --chart-2: oklch(0.64 0.15 152);
  --chart-3: oklch(0.74 0.14 78);
  --chart-4: oklch(0.58 0.18 300);
  --chart-5: oklch(0.62 0.2 16);

  /* Sidebar CLARO (blanco) */
  --sidebar: oklch(1 0 0); /* #ffffff */
  --sidebar-foreground: oklch(0.372 0.039 257); /* #334155 */
  --sidebar-primary: oklch(0.540 0.255 266); /* #2755ff */
  --sidebar-primary-foreground: oklch(0.99 0 0);
  --sidebar-accent: oklch(0.96 0.012 266); /* hover claro */
  --sidebar-accent-foreground: oklch(0.372 0.039 257);
  --sidebar-border: oklch(0.92 0.006 286);
  --sidebar-ring: oklch(0.540 0.255 266);
}
```

- [ ] **Step 2: Actualizar el gradiente del `body` al azul nuevo**

En el bloque `body` (líneas ~167-169), reemplazar:

```css
    background-image:
      radial-gradient(900px 480px at 100% -5%, oklch(0.62 0.125 226 / 0.05), transparent 60%),
      radial-gradient(720px 420px at -5% 108%, oklch(0.64 0.15 152 / 0.045), transparent 55%);
```

por (primer gradiente al azul nuevo; el segundo, verde de éxito, se conserva):

```css
    background-image:
      radial-gradient(900px 480px at 100% -5%, oklch(0.540 0.255 266 / 0.05), transparent 60%),
      radial-gradient(720px 420px at -5% 108%, oklch(0.64 0.15 152 / 0.045), transparent 55%);
```

- [ ] **Step 3: Verificar que el build de CSS no rompe**

Run: `npm run build`
Expected: build OK (`✓ Compiled successfully`). Valores OKLCH válidos no rompen el build.

- [ ] **Step 4: Verificación visual (modo claro)**

Run: `docker-compose up -d db && npm run dev`
Con el tema en **claro**, abrir `http://localhost:3000/dashboard` y `/dashboard/.../control-de-horas` (Control de Horas) y comparar contra los mockups del scratchpad `palette-1.png` y `palette-3.png`:
- Sidebar **blanco**, item activo **azul** (`#2755ff`) con texto blanco, items inactivos en texto oscuro.
- Fondo de la app gris frío claro (`#f7f6f9`), cards blancas.
- Tabs activos con texto/subrayado azul; input en foco con borde azul; botones circulares con borde azul.

Expected: coincide con `palette-1.png` y `palette-3.png`.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): paleta azul en modo claro + sidebar blanco

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Modo oscuro (`.dark`)

**Files:**
- Modify: `src/app/globals.css:111-154` (bloque `.dark`)

**Interfaces:**
- Consumes: la paleta de Task 1 (tokens compartidos como `--sidebar-primary` ya en azul).
- Produces: tokens de modo oscuro con fondo `#2a2d3e`, cards/sidebar `#33364a`, primario azul.

- [ ] **Step 1: Reemplazar el bloque `.dark` completo**

Reemplazar el bloque actual `.dark { ... }` (líneas 111-154) por:

```css
.dark {
  --background: oklch(0.302 0.031 277); /* #2a2d3e */
  --foreground: oklch(0.96 0.01 250);
  --card: oklch(0.339 0.035 278); /* #33364a */
  --card-foreground: oklch(0.96 0.01 250);
  --popover: oklch(0.339 0.035 278);
  --popover-foreground: oklch(0.96 0.01 250);

  --primary: oklch(0.461 0.261 264); /* #0736e6 */
  --primary-foreground: oklch(0.99 0 0);

  --secondary: oklch(0.36 0.03 278);
  --secondary-foreground: oklch(0.96 0.01 250);
  --muted: oklch(0.36 0.03 278);
  --muted-foreground: oklch(0.72 0.02 266);
  --accent: oklch(0.4 0.05 266);
  --accent-foreground: oklch(0.96 0.01 250);

  --destructive: oklch(0.68 0.19 24);
  --destructive-foreground: oklch(0.99 0 0);
  --success: oklch(0.68 0.15 152);
  --success-foreground: oklch(0.16 0.02 255);
  --warning: oklch(0.79 0.14 80);
  --warning-foreground: oklch(0.22 0.04 80);

  --border: oklch(0.4 0.025 278);
  --input: oklch(0.42 0.03 278);
  --ring: oklch(0.461 0.261 264);

  --chart-1: oklch(0.461 0.261 264);
  --chart-2: oklch(0.7 0.15 152);
  --chart-3: oklch(0.79 0.14 80);
  --chart-4: oklch(0.66 0.18 300);
  --chart-5: oklch(0.68 0.2 16);

  --sidebar: oklch(0.339 0.035 278); /* #33364a */
  --sidebar-foreground: oklch(0.85 0.02 250);
  --sidebar-primary: oklch(0.540 0.255 266); /* #2755ff item activo */
  --sidebar-primary-foreground: oklch(0.99 0 0);
  --sidebar-accent: oklch(0.4 0.05 266);
  --sidebar-accent-foreground: oklch(0.96 0.01 240);
  --sidebar-border: oklch(0.4 0.025 278);
  --sidebar-ring: oklch(0.540 0.255 266);
}
```

- [ ] **Step 2: Verificar que el build de CSS no rompe**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 3: Verificación visual (modo oscuro)**

Con `npm run dev` y el tema en **oscuro**, abrir `http://localhost:3000/dashboard` y comparar contra el mockup `palette-2.png`:
- Fondo de la app azul-gris oscuro (`#2a2d3e`), cards `#33364a`.
- Sidebar oscuro, item activo **azul** (`#2755ff`) con texto blanco.
- Texto legible (contraste suficiente) sobre fondo y cards.

Expected: coincide con `palette-2.png`. Si algún borde/card no se distingue del fondo, ajustar `--border`/`--card` un escalón de lightness y re-verificar.

- [ ] **Step 4: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): paleta azul en modo oscuro

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review (resultado)

**Spec coverage:**
- Primario `#2755ff` (claro) / `#0736e6` (oscuro) → Task 1 / Task 2.
- `--ring` foco `#0036ff` (claro) → Task 1.
- Sidebar claro-en-claro / oscuro-en-oscuro → Task 1 (`:root`) + Task 2 (`.dark`).
- Fondos `#f7f6f9` / `#2a2d3e` y cards `#33364a` → Task 1 / Task 2.
- `--chart-1` azul, `--chart-2..5` conservados → ambas tareas.
- Verificación visual contra los 3 mockups → Task 1 (palette-1/3) + Task 2 (palette-2).
- Riesgo de colores hardcodeados → descartado por grep (documentado en Architecture); no requiere tarea.

**Placeholder scan:** sin TBD/TODO; cada token tiene su valor OKLCH concreto.

**Type/valor consistency:** `oklch(0.540 0.255 266)` (#2755ff) se usa idéntico para `--primary`/`--sidebar-primary`/`--chart-1` en claro y para `--sidebar-primary` en oscuro; `oklch(0.461 0.261 264)` (#0736e6) para `--primary`/`--ring`/`--chart-1` en oscuro. Consistente entre tareas.
