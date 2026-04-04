'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/shared/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/shared/components/ui/collapsible';
import { Button } from '@/shared/components/ui/button';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

interface CollapsibleCardProps {
  children: React.ReactNode;
  header: React.ReactNode;
  headerRight?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  headerClassName?: string;
}

export function _CollapsibleCard({
  children,
  header,
  headerRight,
  defaultOpen = true,
  className,
  headerClassName,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className={className}>
        <CardHeader className={cn('pb-2', headerClassName)}>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">{header}</div>
            {headerRight && (
              <div className="flex items-center gap-2 shrink-0">{headerRight}</div>
            )}
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                <ChevronDown
                  className={cn(
                    'h-4 w-4 text-muted-foreground transition-transform duration-200',
                    !open && '-rotate-90'
                  )}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
        </CardHeader>
        <CollapsibleContent>
          <CardContent>{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
