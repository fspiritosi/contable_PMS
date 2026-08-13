import { CreateProduct } from '@/modules/commercial/features/products/features/create';

export const metadata = {
  title: 'Nuevo Ítem | Commercial',
  description: 'Crear nuevo ítem o servicio',
};

export default function NewProductPage() {
  return <CreateProduct />;
}
