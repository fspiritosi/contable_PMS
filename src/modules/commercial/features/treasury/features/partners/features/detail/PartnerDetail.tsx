import { notFound } from 'next/navigation';
import { PermissionGuard } from '@/shared/components/common/PermissionGuard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/components/ui/tabs';
import { getPartnerById } from '../list/actions.server';
import { getPartnerAccountStatement } from './actions.server';
import { _PartnerDetailContent } from './components/_PartnerDetailContent';
import { _PartnerAccountTab } from './components/_PartnerAccountTab';

interface PartnerDetailProps {
  partnerId: string;
}

export async function PartnerDetail({ partnerId }: PartnerDetailProps) {
  const [partner, accountStatement] = await Promise.all([
    getPartnerById(partnerId),
    getPartnerAccountStatement(partnerId),
  ]);

  if (!partner) {
    notFound();
  }

  return (
    <PermissionGuard module="commercial.treasury.partners" action="view" redirect>
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="general">Información General</TabsTrigger>
          <TabsTrigger value="account">Cuenta Corriente</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-6">
          <_PartnerDetailContent partner={partner} />
        </TabsContent>

        <TabsContent value="account" className="mt-6">
          <_PartnerAccountTab partnerId={partnerId} partnerName={partner.name} initialStatement={accountStatement} />
        </TabsContent>
      </Tabs>
    </PermissionGuard>
  );
}
