-- Migración: Agregar Remitos de Entrega (DeliveryNote)
-- Fecha: 2026-03-16
-- Tarea: COD-314

-- Crear enum de estado
CREATE TYPE delivery_note_status AS ENUM ('PENDING_DELIVERY', 'ACCEPTED', 'INVOICED', 'CANCELLED');

-- Crear tabla de remitos de entrega
CREATE TABLE delivery_notes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL,
    customer_id uuid NOT NULL,
    warehouse_id uuid NOT NULL,
    number integer NOT NULL,
    full_number text NOT NULL,
    sales_invoice_id uuid,
    delivery_date date NOT NULL,
    notes text,
    status delivery_note_status NOT NULL DEFAULT 'PENDING_DELIVERY',
    created_by text NOT NULL,
    created_at timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp(3) without time zone NOT NULL,
    CONSTRAINT delivery_notes_pkey PRIMARY KEY (id),
    CONSTRAINT delivery_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT delivery_notes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES contractors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT delivery_notes_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT delivery_notes_sales_invoice_id_fkey FOREIGN KEY (sales_invoice_id) REFERENCES sales_invoices(id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- Índices
CREATE UNIQUE INDEX delivery_notes_company_id_number_key ON delivery_notes(company_id, number);
CREATE INDEX delivery_notes_company_id_status_idx ON delivery_notes(company_id, status);
CREATE INDEX delivery_notes_customer_id_idx ON delivery_notes(customer_id);
CREATE INDEX delivery_notes_sales_invoice_id_idx ON delivery_notes(sales_invoice_id);

-- Crear tabla de líneas de remito de entrega
CREATE TABLE delivery_note_lines (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    delivery_note_id uuid NOT NULL,
    product_id uuid NOT NULL,
    description text NOT NULL,
    quantity numeric(12,3) NOT NULL,
    notes text,
    CONSTRAINT delivery_note_lines_pkey PRIMARY KEY (id),
    CONSTRAINT delivery_note_lines_delivery_note_id_fkey FOREIGN KEY (delivery_note_id) REFERENCES delivery_notes(id) ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT delivery_note_lines_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
