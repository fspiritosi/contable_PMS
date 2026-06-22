/**
 * Template de PDF de Factura de Compra
 */

import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { styles } from './styles';
import type { PurchaseInvoicePDFData } from './types';
import { LinkedDocumentsSection } from '@/modules/commercial/shared/pdf/LinkedDocumentsSection';
import moment from 'moment';

interface PurchaseInvoiceTemplateProps {
  data: PurchaseInvoicePDFData;
}

export function PurchaseInvoiceTemplate({ data }: PurchaseInvoiceTemplateProps) {
  const { company, invoice, supplier, lines, totals, purchaseOrder, notes, linkedDocuments } = data;
  const isTypeA = invoice.type === 'A';

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {company.logoDataUri && (
              <Image src={company.logoDataUri} style={styles.logo} />
            )}
            <Text style={[styles.bold, { fontSize: 12, marginBottom: 5 }]}>
              {company.name}
            </Text>
            <Text style={styles.smallText}>CUIT: {company.taxId}</Text>
            <Text style={styles.smallText}>{company.address}</Text>
            {company.phone && <Text style={styles.smallText}>Tel: {company.phone}</Text>}
            {company.email && <Text style={styles.smallText}>Email: {company.email}</Text>}
          </View>

          <View style={styles.headerCenter}>
            <Text style={styles.invoiceType}>{invoice.type}</Text>
            <Text style={styles.invoiceTypeLabel}>COMPRA</Text>
          </View>

          <View style={styles.headerRight}>
            <Text style={[styles.bold, { fontSize: 11, marginBottom: 5 }]}>
              {invoice.voucherType}
            </Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Nro. Comprobante:</Text>
              <Text style={styles.infoValue}>{invoice.fullNumber}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Fecha de Emisión:</Text>
              <Text style={styles.infoValue}>
                {moment(invoice.issueDate).format('DD/MM/YYYY')}
              </Text>
            </View>
            {invoice.dueDate && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Fecha de Vto.:</Text>
                <Text style={styles.infoValue}>
                  {moment(invoice.dueDate).format('DD/MM/YYYY')}
                </Text>
              </View>
            )}
            {purchaseOrder && (
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>Orden de Compra:</Text>
                <Text style={styles.infoValue}>{purchaseOrder.fullNumber}</Text>
              </View>
            )}
          </View>
        </View>

        {/* PROVEEDOR */}
        <View style={styles.supplierSection}>
          <Text style={[styles.sectionTitle, { marginTop: 0 }]}>DATOS DEL PROVEEDOR</Text>
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
          {supplier.taxCondition && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Condición IVA:</Text>
              <Text style={styles.infoValue}>{supplier.taxCondition}</Text>
            </View>
          )}
          {supplier.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Domicilio:</Text>
              <Text style={styles.infoValue}>{supplier.address}</Text>
            </View>
          )}
        </View>

        {/* TABLA DE PRODUCTOS */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.col1}>Código</Text>
            <Text style={styles.col2}>Descripción</Text>
            <Text style={styles.col3}>Cant.</Text>
            <Text style={styles.col4}>UM</Text>
            <Text style={styles.col5}>Costo Unit.</Text>
            {isTypeA && <Text style={styles.col6}>IVA %</Text>}
            <Text style={styles.col7}>Subtotal</Text>
            <Text style={styles.col8}>Total</Text>
          </View>

          {lines.map((line, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={styles.col1}>{line.code || '—'}</Text>
              <Text style={styles.col2}>{line.description}</Text>
              <Text style={styles.col3}>{line.quantity.toFixed(3)}</Text>
              <Text style={styles.col4}>{line.unitOfMeasure}</Text>
              <Text style={styles.col5}>${line.unitCost.toFixed(2)}</Text>
              {isTypeA && <Text style={styles.col6}>{line.vatRate.toFixed(2)}%</Text>}
              <Text style={styles.col7}>${line.subtotal.toFixed(2)}</Text>
              <Text style={styles.col8}>${line.total.toFixed(2)}</Text>
            </View>
          ))}
        </View>

        {/* TOTALES */}
        <View style={styles.totalsSection}>
          {isTypeA && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal:</Text>
                <Text style={styles.totalValue}>
                  ${totals.subtotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </Text>
              </View>

              {totals.vatByRate && totals.vatByRate.length > 0 && (
                <>
                  {totals.vatByRate.map((vat, index) => (
                    <View key={index} style={styles.totalRow}>
                      <Text style={styles.totalLabel}>IVA {vat.rate}%:</Text>
                      <Text style={styles.totalValue}>
                        ${vat.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                      </Text>
                    </View>
                  ))}
                </>
              )}

              {totals.otherTaxes > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Otros Impuestos:</Text>
                  <Text style={styles.totalValue}>
                    ${totals.otherTaxes.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              )}
            </>
          )}

          <View style={styles.grandTotal}>
            <Text>TOTAL:</Text>
            <Text>${totals.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</Text>
          </View>
        </View>

        {/* OBSERVACIONES */}
        {notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>OBSERVACIONES</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}

        {/* CAE */}
        {invoice.cae && (
          <View style={styles.caeSection}>
            <Text style={[styles.bold, { marginBottom: 5 }]}>
              Comprobante Autorizado por AFIP
            </Text>
            <View style={styles.caeRow}>
              <Text style={styles.caeLabel}>CAE:</Text>
              <Text style={styles.caeValue}>{invoice.cae}</Text>
            </View>
          </View>
        )}

        {/* DOCUMENTOS VINCULADOS */}
        {linkedDocuments && linkedDocuments.sections.length > 0 && (
          <LinkedDocumentsSection data={linkedDocuments} />
        )}

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text style={[styles.smallText, { textAlign: 'center' }]}>
            Documento generado electrónicamente - {moment().format('DD/MM/YYYY HH:mm')}
          </Text>
        </View>
      </Page>
    </Document>
  );
}
