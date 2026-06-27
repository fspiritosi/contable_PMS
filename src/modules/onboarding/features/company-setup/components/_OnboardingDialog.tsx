'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, ArrowRight, ArrowLeft } from 'lucide-react';

import { Dialog, DialogContent } from '@/shared/components/ui/dialog';
import { DialogTitle, DialogDescription } from '@/shared/components/ui/dialog';
import { Button } from '@/shared/components/ui/button';

import { onboardingSchema, type OnboardingInput } from '../schema';
import { completeCompanyOnboarding } from '../actions.server';
import { _StepIndicator } from './_StepIndicator';
import { _ProgressDots } from './_ProgressDots';
import { _StepIdentity } from './_StepIdentity';
import { _StepFiscal } from './_StepFiscal';
import { _StepContact } from './_StepContact';
import { _StepBranding } from './_StepBranding';

const STEP_FIELDS: Record<1 | 2 | 3 | 4, (keyof OnboardingInput)[]> = {
  1: ['name', 'industry', 'description'],
  2: ['taxId', 'taxStatus'],
  3: ['email', 'phone', 'country', 'provinceId', 'cityId', 'address'],
  4: [],
};

interface Props {
  companyId: string;
  defaultName: string;
}

export function _OnboardingDialog({ companyId, defaultName }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // pendingLogo se mantiene por compatibilidad con el step de branding pero
  // todavía no se sube al servidor durante el onboarding. Ver _StepBranding.
  const [, setPendingLogo] = useState<File | null>(null);
  const [logoUrl] = useState<string | null>(null);
  const [submitting, startTransition] = useTransition();

  const formBase = useForm({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      name: defaultName.replace(/ - Empresa$/, ''),
      country: 'Argentina',
    },
  });
  const form = formBase as unknown as UseFormReturn<OnboardingInput>;

  const handleNext = async () => {
    const valid = await form.trigger(STEP_FIELDS[step]);
    if (!valid) return;
    if (step < 4) setStep((s) => (s + 1) as 1 | 2 | 3 | 4);
  };

  const handleBack = () => {
    if (step > 1) setStep((s) => (s - 1) as 1 | 2 | 3 | 4);
  };

  const handleSubmit = form.handleSubmit((values: OnboardingInput) => {
    startTransition(async () => {
      try {
        await completeCompanyOnboarding(companyId, {
          ...values,
          logoUrl,
        });
        toast.success('Empresa lista. ¡Bienvenido!');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se pudo guardar la empresa');
      }
    });
  });

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="!max-w-4xl !p-0 !gap-0 overflow-hidden sm:rounded-2xl flex max-h-[90dvh] flex-col"
      >
        <DialogTitle className="sr-only">Configurá tu empresa</DialogTitle>
        <DialogDescription className="sr-only">
          Completá los datos de tu empresa en cuatro pasos para comenzar.
        </DialogDescription>

        <div className="grid md:grid-cols-[2fr_3fr] h-[640px] max-h-[90dvh] min-h-0">
          <aside className="relative bg-zinc-50 dark:bg-zinc-900 hidden md:block border-r">
            <div
              aria-hidden
              className="absolute inset-0 opacity-[0.04] pointer-events-none"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' /%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' /%3E%3C/svg%3E\")",
              }}
            />
            <div className="relative h-full">
              <_StepIndicator step={step} />
            </div>
          </aside>

          <main className="flex flex-col">
            <div className="flex-1 min-h-0 px-8 py-10 md:px-12 md:py-14 overflow-y-auto">
              <form
                onSubmit={handleSubmit}
                key={step}
                className="animate-step-in"
                noValidate
              >
                {step === 1 && <_StepIdentity form={form} />}
                {step === 2 && <_StepFiscal form={form} />}
                {step === 3 && <_StepContact form={form} />}
                {step === 4 && (
                  <_StepBranding
                    form={form}
                    logoUrl={logoUrl}
                    onPendingFileChange={setPendingLogo}
                  />
                )}
              </form>
            </div>
            <footer className="border-t px-8 py-6 md:px-12 flex items-center justify-between gap-4 bg-background/80 backdrop-blur">
              <_ProgressDots current={step} />
              <div className="flex items-center gap-3">
                {step > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleBack}
                    disabled={submitting}
                  >
                    <ArrowLeft className="mr-1 size-4" /> Atrás
                  </Button>
                )}
                {step < 4 && (
                  <Button type="button" onClick={handleNext} disabled={submitting}>
                    Continuar <ArrowRight className="ml-1 size-4" />
                  </Button>
                )}
                {step === 4 && (
                  <Button type="button" onClick={handleSubmit} disabled={submitting}>
                    {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                    Crear empresa
                  </Button>
                )}
              </div>
            </footer>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
