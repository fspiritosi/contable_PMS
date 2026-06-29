import { EditProduct } from '@/modules/commercial/features/products/features/edit';

export const metadata = {
  title: 'Editar Artículo | Commercial',
  description: 'Editar información de artículo',
};

interface EditProductPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function EditProductPage({ params }: EditProductPageProps) {
  const { id } = await params;
  return <EditProduct productId={id} />;
}
