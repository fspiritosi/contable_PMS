/**
 * Template de PDF de Factura
 * Funciona para tipos A, B y C según normativa AFIP
 */

import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { styles } from './styles';
import type { InvoicePDFData } from './types';
import moment from 'moment';
import { LinkedDocumentsSection } from '@/modules/commercial/shared/pdf/LinkedDocumentsSection';

interface InvoiceTemplateProps {
  data: InvoicePDFData;
}

const fmtNum = (value: number, decimals = 2) =>
  value.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function InvoiceTemplate({ data }: InvoiceTemplateProps) {
  const {
    themeConfig,
    headerText,
    footerText,
    notesDefault,
    showIssuer = true,
    showReceiver = true,
    showNotes = true,
    showCae = true,
    company,
    invoice,
    customer,
    lines,
    totals,
    notes,
    linkedDocuments,
  } = data;
  const isTypeA = invoice.type === 'A';
  const effectiveNotes = notes || notesDefault;
  const hasAnyDiscount = lines.some(
    (l) => (l.discountPercent && l.discountPercent > 0) || (l.discountAmount && l.discountAmount > 0)
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER - Empresa y tipo de factura */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: themeConfig.borderColor,
              borderBottomWidth: themeConfig.headerBorderWidth,
            },
          ]}
        >
          {/* Datos de la empresa */}
          {showIssuer && (
          <View style={styles.headerLeft}>
            {company.logoDataUri && (
              <Image src={company.logoDataUri} style={styles.logo} />
            )}
            <Text style={[styles.bold, { fontSize: 12, marginBottom: 5 }]}>
              {company.name}
            </Text>
            <Text style={styles.smallText}>CUIT: {company.taxId}</Text>
            <Text style={styles.smallText}>{company.taxCondition}</Text>
            <Text style={styles.smallText}>{company.address}</Text>
            {company.phone && <Text style={styles.smallText}>Tel: {company.phone}</Text>}
            {company.email && <Text style={styles.smallText}>Email: {company.email}</Text>}
          </View>
          )}
          {headerText && (
            <Text style={{ marginTop: 8, fontSize: 8, fontStyle: 'italic', textAlign: 'center' }}>
              {headerText}
            </Text>
          )}

          {/* Tipo de factura */}
          <View style={styles.headerCenter}>
            <Text style={styles.invoiceType}>{invoice.type}</Text>
            <Text style={styles.invoiceTypeLabel}>COD. 01</Text>
          </View>

          {/* Datos del comprobante */}
          <View style={styles.headerRight}>
            <Text style={[styles.bold, { fontSize: 11, marginBottom: 5 }]}>
              {invoice.voucherType}
            </Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Punto de Venta:</Text>
              <Text style={styles.infoValue}>
                {invoice.pointOfSale.toString().padStart(4, '0')}
              </Text>
            </View>
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
          </View>
        </View>

        {/* CLIENTE / RECEPTOR */}
        {showReceiver && (
        <View style={styles.customerSection}>
          <Text style={[styles.sectionTitle, { marginTop: 0 }]}>DATOS DEL RECEPTOR</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Razón Social:</Text>
            <Text style={styles.infoValue}>{customer.name}</Text>
          </View>
          {customer.taxId && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>CUIT/DNI:</Text>
              <Text style={styles.infoValue}>{customer.taxId}</Text>
            </View>
          )}
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Condición IVA:</Text>
            <Text style={styles.infoValue}>{customer.taxCondition}</Text>
          </View>
          {customer.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Domicilio:</Text>
              <Text style={styles.infoValue}>{customer.address}</Text>
            </View>
          )}
        </View>
        )}

        {/* TABLA DE PRODUCTOS */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.col1}>#</Text>
            <Text style={styles.col2}>Descripción</Text>
            <Text style={styles.col3}>Cant.</Text>
            <Text style={styles.col4}>UM</Text>
            <Text style={styles.col5}>P. Unit.</Text>
            {hasAnyDiscount && <Text style={styles.colDto}>Dto.</Text>}
            {isTypeA && <Text style={styles.col6}>IVA %</Text>}
            <Text style={styles.col7}>Subtotal</Text>
            <Text style={styles.col8}>Total</Text>
          </View>

          {lines.map((line, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={styles.col1}>{index + 1}</Text>
              <Text style={styles.col2}>{line.description}</Text>
              <Text style={styles.col3}>{fmtNum(line.quantity, 3)}</Text>
              <Text style={styles.col4}>{line.unitOfMeasure}</Text>
              <Text style={styles.col5}>${fmtNum(line.unitPrice)}</Text>
              {hasAnyDiscount && (
                <Text style={styles.colDto}>
                  {line.discountPercent && line.discountPercent > 0
                    ? `${line.discountPercent}%`
                    : line.discountAmount && line.discountAmount > 0
                      ? `$${fmtNum(line.discountAmount)}`
                      : ''}
                </Text>
              )}
              {isTypeA && <Text style={styles.col6}>{fmtNum(line.vatRate)}%</Text>}
              <Text style={styles.col7}>${fmtNum(line.subtotal)}</Text>
              <Text style={styles.col8}>${fmtNum(line.total)}</Text>
            </View>
          ))}
        </View>

        {/* TOTALES */}
        <View style={styles.totalsSection}>
          {totals.discountTotal != null && totals.discountTotal > 0 && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal (antes dto):</Text>
                <Text style={styles.totalValue}>
                  ${(totals.totalBeforeDiscount ?? totals.subtotal).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Descuento:</Text>
                <Text style={styles.totalValue}>
                  -${totals.discountTotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            </>
          )}

          {isTypeA && (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Subtotal:</Text>
                <Text style={styles.totalValue}>
                  ${totals.subtotal.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </Text>
              </View>

              {/* IVA por alícuota */}
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

              {/* Desglose de tributos, uno por percepción más los impuestos
                  internos, en vez del agregado mudo de antes (TSK-644) */}
              {totals.perceptions.map((perception, i) => (
                <View style={styles.totalRow} key={`perc-${i}`}>
                  <Text style={styles.totalLabel}>{perception.label}:</Text>
                  <Text style={styles.totalValue}>
                    ${perception.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              ))}

              {totals.internalTaxes > 0 && (
                <View style={styles.totalRow}>
                  <Text style={styles.totalLabel}>Impuestos Internos:</Text>
                  <Text style={styles.totalValue}>
                    ${totals.internalTaxes.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
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
        {showNotes && effectiveNotes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>OBSERVACIONES</Text>
            <Text style={styles.notesText}>{effectiveNotes}</Text>
          </View>
        )}

        {/* CAE (si existe) */}
        {showCae && invoice.cae && (
          <View style={styles.caeSection}>
            <Text style={[styles.bold, { marginBottom: 5 }]}>
              Comprobante Autorizado por AFIP
            </Text>
            <View style={styles.caeRow}>
              <Text style={styles.caeLabel}>CAE:</Text>
              <Text style={styles.caeValue}>{invoice.cae}</Text>
            </View>
            <View style={styles.caeRow}>
              <Text style={styles.caeLabel}>Fecha de Vencimiento CAE:</Text>
              <Text style={styles.caeValue}>
                {invoice.caeExpiryDate
                  ? moment(invoice.caeExpiryDate).format('DD/MM/YYYY')
                  : '-'}
              </Text>
            </View>
          </View>
        )}

        {/* DOCUMENTOS VINCULADOS (opcional) */}
        {linkedDocuments && linkedDocuments.sections.length > 0 && (
          <LinkedDocumentsSection data={linkedDocuments} />
        )}

        {/* FOOTER */}
        <View style={styles.footer}>
          {footerText && <Text style={{ marginBottom: 2 }}>{footerText}</Text>}
          <Text style={[styles.smallText, { textAlign: 'center' }]}>
            Este comprobante es válido como factura electrónica según Resolución General AFIP
            N° 4291/2018
          </Text>
        </View>
      </Page>
    </Document>
  );
}
