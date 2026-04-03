'use client';

import { createContext, useContext, useMemo } from 'react';
import type { IndustryType } from '@/shared/lib/industry';
import { isFeatureAvailableForIndustry, INDUSTRY_TYPES } from '@/shared/lib/industry';

interface IndustryContextValue {
  industryType: IndustryType;
  isFeatureAvailable: (feature: string) => boolean;
}

const IndustryContext = createContext<IndustryContextValue>({
  industryType: INDUSTRY_TYPES.GENERAL,
  isFeatureAvailable: () => true,
});

export function IndustryProvider({
  industryType,
  children,
}: {
  industryType: IndustryType;
  children: React.ReactNode;
}) {
  const value = useMemo(
    () => ({
      industryType,
      isFeatureAvailable: (feature: string) =>
        isFeatureAvailableForIndustry(feature, industryType),
    }),
    [industryType],
  );

  return <IndustryContext.Provider value={value}>{children}</IndustryContext.Provider>;
}

export function useIndustry() {
  return useContext(IndustryContext);
}
