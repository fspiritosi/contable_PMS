import { ProductDetail } from '@/modules/commercial/features/products/features/detail';

export const metadata = {
  title: 'Detalle de Ítem | Commercial',
  description: 'Ver detalle de ítem',
};

interface ProductDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { id } = await params;
  return <ProductDetail productId={id} />;
}
