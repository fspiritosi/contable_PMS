/**
 * Template de PDF de Orden de Pago
 */

import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { styles } from './styles';
import type { PaymentOrderPDFData } from './types';
import { LinkedDocumentsSection } from '@/modules/commercial/shared/pdf/LinkedDocumentsSection';
import moment from 'moment';

interface PaymentOrderTemplateProps {
  data: PaymentOrderPDFData;
}

export function PaymentOrderTemplate({ data }: PaymentOrderTemplateProps) {
  const { company, paymentOrder, supplier, invoices, payments, totalAmount, notes, linkedDocuments } = data;

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
              <Text style={styles.title}>ORDEN DE PAGO</Text>
              <Text style={styles.subtitle}>
                N° {paymentOrder.fullNumber}
              </Text>
              <Text style={styles.subtitle}>
                Fecha: {moment(paymentOrder.date).format('DD/MM/YYYY')}
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
        </View>

        {/* FACTURAS QUE SE PAGAN */}
        <View>
          <Text style={styles.sectionTitle}>FACTURAS A PAGAR</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.col1}>Número</Text>
              <Text style={styles.col2}>Fecha</Text>
              <Text style={styles.col3}>Total</Text>
              <Text style={styles.col4}>Pendiente</Text>
              <Text style={styles.col5}>A Pagar</Text>
            </View>

            {invoices.map((invoice, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.col1}>{invoice.fullNumber}</Text>
                <Text style={styles.col2}>
                  {moment(invoice.issueDate).format('DD/MM/YYYY')}
                </Text>
                <Text style={styles.col3}>
                  ${invoice.total.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </Text>
                <Text style={styles.col4}>
                  ${invoice.pendingAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </Text>
                <Text style={styles.col5}>
                  ${invoice.amountToPay.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* FORMAS DE PAGO */}
        <View>
          <Text style={styles.sectionTitle}>FORMAS DE PAGO</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.paymentCol1}>Método</Text>
              <Text style={styles.paymentCol2}>Detalle</Text>
              <Text style={styles.paymentCol3}>Monto</Text>
            </View>

            {payments.map((payment, index) => {
              let detail = '';
              if (payment.cashRegister) {
                detail = `Caja: ${payment.cashRegister.code} - ${payment.cashRegister.name}`;
              } else if (payment.bankAccount) {
                detail = `${payment.bankAccount.bankName} - ${payment.bankAccount.accountNumber}`;
              } else if (payment.checkNumber) {
                detail = `Cheque N° ${payment.checkNumber}`;
              } else if (payment.cardLast4) {
                detail = `Tarjeta **** ${payment.cardLast4}`;
              } else if (payment.reference) {
                detail = payment.reference;
              }

              return (
                <View key={index} style={styles.tableRow}>
                  <Text style={styles.paymentCol1}>{payment.paymentMethod}</Text>
                  <Text style={styles.paymentCol2}>{detail}</Text>
                  <Text style={styles.paymentCol3}>
                    ${payment.amount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* TOTAL */}
        <View style={styles.grandTotal}>
          <Text>TOTAL A PAGAR:</Text>
          <Text>${totalAmount.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</Text>
        </View>

        {/* OBSERVACIONES */}
        {notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>OBSERVACIONES</Text>
            <Text style={styles.notesText}>{notes}</Text>
          </View>
        )}

        {/* DOCUMENTOS VINCULADOS */}
        {linkedDocuments && <LinkedDocumentsSection data={linkedDocuments} />}

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
