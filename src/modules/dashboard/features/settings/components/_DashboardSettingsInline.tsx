'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { Switch } from '@/shared/components/ui/switch';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Separator } from '@/shared/components/ui/separator';
import { Label } from '@/shared/components/ui/label';
import { Button } from '@/shared/components/ui/button';
import { RotateCcw } from 'lucide-react';
import { WIDGET_CATEGORIES, getWidgetsByCategory } from '../../../constants';
import { useDashboardPreferences } from '../../../hooks/useDashboardPreferences';

interface DashboardSettingsInlineProps {
  companyId: string;
}

export function _DashboardSettingsInline({ companyId }: DashboardSettingsInlineProps) {
  const { preferences, toggleWidget, setAccordionsOpen, isWidgetVisible, resetDefaults } =
    useDashboardPreferences(companyId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Preferencias</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Accordion setting */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Iniciar widgets abiertos</Label>
            <p className="text-xs text-muted-foreground">
              Los acordeones de los widgets se abren automaticamente al cargar
            </p>
          </div>
          <Switch
            checked={preferences.accordionsOpen}
            onCheckedChange={setAccordionsOpen}
          />
        </div>

        <Separator />

        {/* Widgets by category */}
        <div className="space-y-4">
          <Label className="text-sm font-medium">Widgets visibles</Label>
          {WIDGET_CATEGORIES.map((category) => {
            const widgets = getWidgetsByCategory(category);
            return (
              <div key={category}>
                <p className="text-sm font-medium text-muted-foreground mb-2">{category}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {widgets.map((widget) => (
                    <label
                      key={widget.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={isWidgetVisible(widget.id)}
                        onCheckedChange={() => toggleWidget(widget.id)}
                      />
                      <span>{widget.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <Separator />

        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={resetDefaults} className="gap-1">
            <RotateCcw className="h-3.5 w-3.5" />
            Restaurar valores por defecto
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
