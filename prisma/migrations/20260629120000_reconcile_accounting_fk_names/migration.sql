-- Reconciliación de nombres de foreign keys en accounting_settings.
-- Prisma 7 cambió la convención de nombres de FK: ahora deriva el nombre de la
-- columna escalar (perception_*_account_id) en lugar del campo de relación.
-- La BD ya tiene los nombres nuevos (_account_id_fkey), pero el historial de
-- migraciones los creó con los nombres viejos (_fkey). Esta migración renombra
-- las constraints para que el historial converja con la BD real.
-- Se marca como "applied" con `prisma migrate resolve` porque la BD ya está en
-- este estado; NO se ejecuta sobre la base con datos.

ALTER TABLE "accounting_settings"
  RENAME CONSTRAINT "accounting_settings_perception_iibb_collected_fkey"
  TO "accounting_settings_perception_iibb_collected_account_id_fkey";

ALTER TABLE "accounting_settings"
  RENAME CONSTRAINT "accounting_settings_perception_iibb_suffered_fkey"
  TO "accounting_settings_perception_iibb_suffered_account_id_fkey";

ALTER TABLE "accounting_settings"
  RENAME CONSTRAINT "accounting_settings_perception_iva_collected_fkey"
  TO "accounting_settings_perception_iva_collected_account_id_fkey";

ALTER TABLE "accounting_settings"
  RENAME CONSTRAINT "accounting_settings_perception_iva_suffered_fkey"
  TO "accounting_settings_perception_iva_suffered_account_id_fkey";
