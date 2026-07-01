export interface ProductCategory extends Record<string, unknown> {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  parent?: {
    id: string;
    name: string;
  } | null;
  children?: ProductCategory[];
  _count?: {
    products: number;
    children: number;
  };
}

export interface CreateCategoryInput {
  name: string;
  description?: string;
  parentId?: string;
}

export type UpdateCategoryInput = Partial<CreateCategoryInput>;
