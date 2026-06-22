/**
 * Template de PDF de Orden de Compra
 */

import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { styles } from './styles';
import type { PurchaseOrderPDFData } from './types';
import moment from 'moment';
import { LinkedDocumentsSection } from '@/modules/commercial/shared/pdf/LinkedDocumentsSection';

interface PurchaseOrderTemplateProps {
  data: PurchaseOrderPDFData;
}

function formatAmount(value: number): string {
  return `$${value.toLocaleString('es-AR', { minimumFractionDigits: 2 })}`;
}

export function PurchaseOrderTemplate({ data }: PurchaseOrderTemplateProps) {
  const { company, purchaseOrder, supplier, lines, subtotal, vatAmount, total, installments, paymentConditions, deliveryAddress, deliveryNotes, notes, linkedDocuments } = data;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            {company.logoDataUri && (
              <Image src={company.logoDataUri} style={styles.logo} />
            )}
            <View style={styles.headerText}>
              <Text style={styles.title}>ORDEN DE COMPRA</Text>
              <Text style={styles.subtitle}>
                N° {purchaseOrder.fullNumber}
              </Text>
              <Text style={styles.subtitle}>
                Fecha: {moment(purchaseOrder.issueDate).format('DD/MM/YYYY')}
              </Text>
            </View>
          </View>
          <View style={styles.companyInfo}>
            <Text>{company.name}</Text>
            <Text>CUIT: {company.taxId}</Text>
            <Text>{company.address}</Text>
            {company.phone && <Text>Tel: {company.phone}</Text>}
            {company.email && <Text>Email: {company.email}</Text>}
          </View>
        </View>

        {/* DATOS DEL PROVEEDOR */}
        <View>
          <Text style={styles.sectionTitle}>PROVEEDOR</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Razón Social:</Text>
            <Text style={styles.infoValue}>
              {supplier.tradeName || supplier.businessName}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>CUIT:</Text>
            <Text style={styles.infoValue}>{supplier.taxId}</Text>
          </View>
          {supplier.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Domicilio:</Text>
              <Text style={styles.infoValue}>{supplier.address}</Text>
            </View>
          )}
          {supplier.phone && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Teléfono:</Text>
              <Text style={styles.infoValue}>{supplier.phone}</Text>
            </View>
          )}
          {supplier.email && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email:</Text>
              <Text style={styles.infoValue}>{supplier.email}</Text>
            </View>
          )}
        </View>

        {/* ENTREGA */}
        {(purchaseOrder.expectedDeliveryDate || deliveryAddress) && (
          <View>
            <Text style={styles.sectionTitle}>ENTREGA</Text>
            {purchaseOrder.expectedDeliveryDate && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Fecha Esperada:</Text>
                <Text style={styles.infoValue}>
                  {moment(purchaseOrder.expectedDeliveryDate).format('DD/MM/YYYY')}
                </Text>
              </View>
            )}
            {deliveryAddress && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Dirección de Entrega:</Text>
                <Text style={styles.infoValue}>{deliveryAddress}</Text>
              </View>
            )}
          </View>
        )}

        {/* LÍNEAS DE PRODUCTOS */}
        <View>
          <Text style={styles.sectionTitle}>DETALLE</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colDesc}>Descripción</Text>
              <Text style={styles.colQty}>Cant.</Text>
              <Text style={styles.colUnit}>Costo Unit.</Text>
              <Text style={styles.colVat}>IVA %</Text>
              <Text style={styles.colSubtotal}>Subtotal</Text>
              <Text style={styles.colTotal}>Total</Text>
            </View>

            {lines.map((line, index) => (
              <View key={index} style={styles.tableRow}>
                <View style={styles.colDesc}>
                  <Text>{line.description}</Text>
                  {line.productCode && (
                    <Text style={styles.smallText}>[{line.productCode}]</Text>
                  )}
                </View>
                <Text style={styles.colQty}>{line.quantity}</Text>
                <Text style={styles.colUnit}>{formatAmount(line.unitCost)}</Text>
                <Text style={styles.colVat}>{line.vatRate}%</Text>
                <Text style={styles.colSubtotal}>{formatAmount(line.subtotal)}</Text>
                <Text style={styles.colTotal}>{formatAmount(line.total)}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* TOTALES */}
        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal:</Text>
            <Text style={styles.totalValue}>{formatAmount(subtotal)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>IVA:</Text>
            <Text style={styles.totalValue}>{formatAmount(vatAmount)}</Text>
          </View>
        </View>

        <View style={styles.grandTotal}>
          <Text>TOTAL:</Text>
          <Text>{formatAmount(total)}</Text>
        </View>

        {/* CUOTAS / ENTREGAS */}
        {installments && installments.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>CUOTAS / ENTREGAS</Text>
            <View style={styles.table}>
              <View style={styles.tableHeader}>
                <Text style={styles.colQty}>N°</Text>
                <Text style={styles.colDesc}>Fecha de Vencimiento</Text>
                <Text style={styles.colTotal}>Monto</Text>
              </View>
              {installments.map((inst, idx) => (
                <View key={idx} style={styles.tableRow}>
                  <Text style={styles.colQty}>{inst.number}</Text>
                  <Text style={styles.colDesc}>{moment(inst.dueDate).format('DD/MM/YYYY')}</Text>
                  <Text style={styles.colTotal}>{formatAmount(inst.amount)}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* CONDICIONES */}
        {(paymentConditions || deliveryNotes) && (
          <View style={styles.conditions}>
            <Text style={styles.conditionsTitle}>CONDICIONES</Text>
            {paymentConditions && (
              <Text style={styles.conditionsText}>
                Condiciones de Pago: {paymentConditions}
              </Text>
            )}
            {deliveryNotes && (
              <Text style={styles.conditionsText}>
                Notas de Entrega: {deliveryNotes}
              </Text>
            )}
          </View>
        )}

        {/* OBSERVACIONES */}
        {notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>OBSERVACIONES</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}

        {/* DOCUMENTOS VINCULADOS (opcional) */}
        {linkedDocuments && linkedDocuments.sections.length > 0 && (
          <LinkedDocumentsSection data={linkedDocuments} />
        )}

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text>
            Documento generado electrónicamente - {moment().format('DD/MM/YYYY HH:mm')}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
