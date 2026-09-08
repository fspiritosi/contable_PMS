'use client';

import { Button } from '@/shared/components/ui/button';
import { CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/shared/components/ui/form';
import { Input } from '@/shared/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select';
import { Textarea } from '@/shared/components/ui/textarea';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, MessageSquarePlus, Send } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import {
  CATEGORIES,
  CATEGORY_BY_SLUG,
  CATEGORY_SLUGS,
  type CategoryDef,
  type CategorySlug,
} from '../constants/categories';
import { useCreateTicket } from '../hooks/useCreateTicket';
import { useUploadAttachment } from '../hooks/useUploadAttachment';
import { TicketAttachmentInput } from './TicketAttachmentInput';
import { TicketPrioritySelect } from './TicketPrioritySelect';

const formSchema = z.object({
  // Derivado de `CATEGORIES`, nunca escrito a mano: la lista la personaliza
  // cada app cliente con las secciones de su sidebar.
  category: z.enum(CATEGORY_SLUGS),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  title: z.string().trim().min(3, 'Mínimo 3 caracteres').max(200, 'Máximo 200 caracteres'),
  description: z
    .string()
    .trim()
    .min(10, 'Contanos un poco más (mínimo 10 caracteres)')
    .max(5000, 'Máximo 5000 caracteres'),
});

type FormValues = z.infer<typeof formSchema>;

/**
 * Los labels van sin ícono a propósito.
 *
 * Un pictograma por campo suma seis glifos de 14px en una columna de 380px sin
 * agregar información: «Categoría» ya dice categoría. Sacarlos deja que se lea
 * la jerarquía del formulario en vez de una grilla de adornos.
 *
 * 11px es el mismo tamaño que usan los micro-encabezados del resto del módulo
 * («Recorrido del ticket», «Lo que reportaste»): mismo rol, misma tipografía.
 */
const LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';

const CATEGORY_PLACEHOLDER = 'Elegí una categoría';

export function TicketForm() {
  const createTicket = useCreateTicket();
  const uploadAttachment = useUploadAttachment();
  const [files, setFiles] = useState<File[]>([]);

  // Los tres genéricos y no sólo el primero: `zodResolver` devuelve un
  // `Resolver<entrada, contexto, salida>` y con un único genérico el de salida
  // queda sin resolver, así que `form.control` deja de tipar y cada
  // `<FormField control={...}>` rompe el chequeo. El schema no transforma
  // nada, por eso entrada y salida son el mismo `FormValues`.
  const form = useForm<FormValues, unknown, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      category: 'otro' as CategorySlug,
      priority: 'medium',
      title: '',
      description: '',
    },
  });

  const description = form.watch('description') ?? '';
  const descriptionLen = description.length;

  async function onSubmit(values: FormValues) {
    try {
      const attachmentKeys: string[] = [];
      for (const file of files) {
        // El ticket todavia no existe aca, asi que no pasamos ticketId.
        // El archivo queda en <project_slug>/<uuid>.<ext> y se asocia al
        // ticket recien al hacer createTicket.
        const { key } = await uploadAttachment.mutateAsync({ file });
        attachmentKeys.push(key);
      }

      await createTicket.mutateAsync({
        category: values.category,
        title: values.title,
        description: values.description,
        priority: values.priority,
        attachmentKeys,
      });

      toast.success('Tu reporte fue enviado. Te avisaremos cuando haya novedades.');
      form.reset({ category: values.category, priority: 'medium', title: '', description: '' });
      setFiles([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No pudimos enviar tu reporte');
    }
  }

  const isSubmitting = form.formState.isSubmitting || createTicket.isPending || uploadAttachment.isPending;

  return (
    <Form {...form}>
      {/* Se fue la trama de puntos que cubría la tarjeta: al 3,5% de opacidad
          no se veía en ninguna pantalla, y lo único que hacía era obligar a
          `relative` a las tres secciones para no quedar tapadas. La textura
          decorativa es además el reflejo más rápido para que un panel se lea
          como plantilla. */}
      <form onSubmit={form.handleSubmit(onSubmit)}>
        {/* `[.border-b]:pb-3.5` pisa el `pb-6` que la Card aplica sola cuando el
            encabezado lleva divisor: 24px abajo dejaban este encabezado más
            alto que el de la columna de la izquierda. */}
        <CardHeader className="gap-1 border-b px-4 pt-3.5 [.border-b]:pb-3.5">
          <CardTitle className="flex items-center gap-2 text-sm">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-inset ring-primary/20">
              <MessageSquarePlus aria-hidden className="size-3.5" />
            </span>
            Reportar un problema
          </CardTitle>
          <CardDescription className="text-xs">
            Contanos qué pasó y vamos a ocuparnos.
          </CardDescription>
        </CardHeader>

        <CardContent className="grid gap-5 px-4 py-5">
          {/* Clasificación */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="category"
              render={({ field }) => {
                /**
                 * El label del trigger se resuelve ACÁ y baja como children del
                 * `SelectValue`, en vez de dejar que lo derive la primitiva.
                 *
                 * Por qué: el módulo se instala en apps que no usan la misma
                 * librería de primitivas. Radix portalea el contenido del
                 * `<SelectItem>` elegido dentro del trigger, así que «Otro»
                 * aparecía solo, de rebote. Base UI no hace eso: imprime el
                 * value crudo salvo que le pases el catálogo por prop, y este
                 * mismo formulario mostraba «otro» en minúscula. TypeScript no
                 * ve la diferencia — las dos tipan igual y compilan en cero —
                 * así que el bug sólo se detecta mirando la pantalla. Con
                 * children explícitos gana lo que decimos nosotros en las dos.
                 *
                 * El placeholder queda cubierto por las dos vías a propósito:
                 * la prop `placeholder` es la que mira Radix cuando no hay
                 * valor, y el fallback de los children es la única que mira
                 * Base UI (donde children siempre gana).
                 *
                 * `CATEGORY_BY_SLUG[...]` puede venir vacío: cada app cliente
                 * reemplaza `CATEGORIES` por las secciones de su sidebar, y un
                 * ticket viejo puede traer un slug que ya no está en la lista.
                 * En ese caso cae al placeholder en vez de romper el render.
                 */
                const selected: CategoryDef | undefined = CATEGORY_BY_SLUG[field.value];
                const SelectedIcon = selected?.icon;

                return (
                  <FormItem>
                    <FormLabel className={LABEL_CLASS}>Categoría</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value} disabled={isSubmitting}>
                      <FormControl>
                        {/* `w-full` porque el trigger de Base UI arranca en
                            `w-fit`: sin esto el control se encoge al ancho del
                            label y cambia de tamaño en cada selección, en vez
                            de ocupar su columna de la grilla. */}
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={CATEGORY_PLACEHOLDER}>
                            {selected && SelectedIcon ? (
                              <span className="flex min-w-0 items-center gap-2">
                                <SelectedIcon aria-hidden className="h-4 w-4 shrink-0" />
                                <span className="truncate">{selected.label}</span>
                              </span>
                            ) : (
                              CATEGORY_PLACEHOLDER
                            )}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CATEGORIES.map((c) => {
                          const Icon = c.icon;
                          return (
                            <SelectItem key={c.slug} value={c.slug}>
                              <span className="flex items-center gap-2">
                                <Icon aria-hidden className="h-4 w-4" />
                                {c.label}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <FormField
              control={form.control}
              name="priority"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className={LABEL_CLASS}>Prioridad</FormLabel>
                  <FormControl>
                    <TicketPrioritySelect
                      value={field.value}
                      onChange={field.onChange}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          {/* Asunto */}
          <FormField
            control={form.control}
            name="title"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={LABEL_CLASS}>Asunto</FormLabel>
                <FormControl>
                  <Input placeholder="Resumí en una línea qué te pasa" {...field} disabled={isSubmitting} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Descripción + char counter */}
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center justify-between">
                  <FormLabel className={LABEL_CLASS}>Descripción</FormLabel>
                  <span
                    className={`text-[11px] tabular-nums ${
                      descriptionLen > 4500 ? 'text-amber-600' : 'text-muted-foreground'
                    }`}
                  >
                    {descriptionLen}/5000
                  </span>
                </div>
                <FormControl>
                  <Textarea
                    rows={6}
                    placeholder="Pasos para reproducir, qué esperabas vs qué pasó…"
                    className="resize-y min-h-[140px]"
                    {...field}
                    disabled={isSubmitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Adjuntos en su propio "panel" sutilmente diferenciado */}
          <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className={LABEL_CLASS}>Adjuntos</span>
              <span className="text-[11px] text-muted-foreground">opcional</span>
            </div>
            <TicketAttachmentInput files={files} onChange={setFiles} disabled={isSubmitting} />
          </div>
        </CardContent>

        <CardFooter className="justify-end border-t px-4 py-3.5 [.border-t]:pt-3.5">
          <Button type="submit" disabled={isSubmitting} className="gap-2">
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {isSubmitting ? 'Enviando…' : 'Enviar reporte'}
          </Button>
        </CardFooter>
      </form>
    </Form>
  );
}
