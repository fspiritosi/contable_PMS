// ============================================
// DISCOUNT-PRESETS FEATURE - BARREL EXPORT
// ============================================

// List Feature (Page)
export { DiscountPresetsList as DiscountPresetsPage } from './list';

// Actions
export {
  getDiscountPresetsPaginated,
  getDiscountPresetsForSelect,
  createDiscountPreset,
  updateDiscountPreset,
  deleteDiscountPreset,
} from './list';

// Types
export type {
  DiscountPresetListItem,
  DiscountPresetOption,
  CreateDiscountPresetInput,
} from './list';
