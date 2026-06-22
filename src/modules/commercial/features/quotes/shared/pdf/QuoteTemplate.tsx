/**
 * Template de PDF de Presupuesto
 */

import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { styles } from './styles';
import type { QuotePDFData } from './types';
import moment from 'moment';

interface QuoteTemplateProps {
  data: QuotePDFData;
}

const fmtNum = (value: number, decimals = 2) =>
  value.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function QuoteTemplate({ data }: QuoteTemplateProps) {
  const { company, quote, recipient, lines, totals, conditions, notes } = data;
  const hasAnyDiscount = lines.some(
    (l) => (l.discountPercent && l.discountPercent > 0) || (l.discountAmount && l.discountAmount > 0)
  );

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER - Empresa y título */}
        <View style={styles.header}>
          {/* Datos de la empresa */}
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

          {/* Datos del presupuesto */}
          <View style={styles.headerRight}>
            <Text style={styles.quoteTitle}>PRESUPUESTO</Text>
            <View style={styles.infoRowRight}>
              <Text style={styles.infoLabelRight}>Nro.:</Text>
              <Text style={styles.infoValueRight}>{quote.number}</Text>
            </View>
            <View style={styles.infoRowRight}>
              <Text style={styles.infoLabelRight}>Fecha de Emisión:</Text>
              <Text style={styles.infoValueRight}>
                {moment(quote.issueDate).format('DD/MM/YYYY')}
              </Text>
            </View>
            {quote.expirationDate && (
              <View style={styles.infoRowRight}>
                <Text style={styles.infoLabelRight}>Válido hasta:</Text>
                <Text style={styles.infoValueRight}>
                  {moment(quote.expirationDate).format('DD/MM/YYYY')}
                </Text>
              </View>
            )}
            <View style={styles.infoRowRight}>
              <Text style={styles.infoLabelRight}>Moneda:</Text>
              <Text style={styles.infoValueRight}>{quote.currency}</Text>
            </View>
          </View>
        </View>

        {/* DESTINATARIO */}
        <View style={styles.recipientSection}>
          <Text style={[styles.sectionTitle, { marginTop: 0 }]}>DATOS DEL DESTINATARIO</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>
              {recipient.type === 'customer' ? 'Razón Social:' : 'Nombre:'}
            </Text>
            <Text style={styles.infoValue}>{recipient.name}</Text>
          </View>
          {recipient.taxId && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>CUIT:</Text>
              <Text style={styles.infoValue}>{recipient.taxId}</Text>
            </View>
          )}
          {recipient.email && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email:</Text>
              <Text style={styles.infoValue}>{recipient.email}</Text>
            </View>
          )}
          {recipient.phone && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Teléfono:</Text>
              <Text style={styles.infoValue}>{recipient.phone}</Text>
            </View>
          )}
          {recipient.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Domicilio:</Text>
              <Text style={styles.infoValue}>{recipient.address}</Text>
            </View>
          )}
        </View>

        {/* TABLA DE PRODUCTOS */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.col1}>#</Text>
            <Text style={styles.col2}>Descripción</Text>
            <Text style={styles.col3}>Cant.</Text>
            <Text style={styles.col4}>UM</Text>
            <Text style={styles.col5}>P. Unit.</Text>
            {hasAnyDiscount && <Text style={styles.colDto}>Dto.</Text>}
            <Text style={styles.col6}>IVA %</Text>
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
              <Text style={styles.col6}>{fmtNum(line.vatRate)}%</Text>
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
                  ${fmtNum(totals.totalBeforeDiscount ?? totals.subtotal)}
                </Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>Descuento:</Text>
                <Text style={styles.totalValue}>
                  -${fmtNum(totals.discountTotal)}
                </Text>
              </View>
            </>
          )}

          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Subtotal:</Text>
            <Text style={styles.totalValue}>
              ${fmtNum(totals.subtotal)}
            </Text>
          </View>

          {/* IVA por alícuota */}
          {totals.vatByRate && totals.vatByRate.length > 0 && (
            <>
              {totals.vatByRate.map((vat, index) => (
                <View key={index} style={styles.totalRow}>
                  <Text style={styles.totalLabel}>IVA {vat.rate}%:</Text>
                  <Text style={styles.totalValue}>
                    ${fmtNum(vat.amount)}
                  </Text>
                </View>
              ))}
            </>
          )}

          <View style={styles.grandTotal}>
            <Text>TOTAL:</Text>
            <Text>${fmtNum(totals.total)}</Text>
          </View>
        </View>

        {/* CONDICIONES */}
        {conditions && (
          <View style={styles.conditions}>
            <Text style={styles.conditionsTitle}>CONDICIONES</Text>
            <Text style={styles.conditionsText}>{conditions}</Text>
          </View>
        )}

        {/* OBSERVACIONES */}
        {notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>OBSERVACIONES</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}

        {/* FOOTER */}
        <View style={styles.footer}>
          <Text style={[styles.smallText, { textAlign: 'center' }]}>
            Este presupuesto no constituye factura. Los precios pueden estar sujetos a cambios.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
