import { CreateProduct } from '@/modules/commercial/features/products/features/create';

export const metadata = {
  title: 'Nuevo Artículo | Commercial',
  description: 'Crear nuevo artículo o servicio',
};

export default function NewProductPage() {
  return <CreateProduct />;
}
