/**
 * Template de PDF de Remito de Recepción
 */

import React from 'react';
import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { styles } from './styles';
import type { ReceivingNotePDFData } from './types';
import { LinkedDocumentsSection } from '@/modules/commercial/shared/pdf/LinkedDocumentsSection';
import moment from 'moment';

interface ReceivingNoteTemplateProps {
  data: ReceivingNotePDFData;
}

export function ReceivingNoteTemplate({ data }: ReceivingNoteTemplateProps) {
  const { company, receivingNote, supplier, warehouse, sourceDocument, lines, notes, linkedDocuments } = data;

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
              <Text style={styles.title}>REMITO DE RECEPCIÓN</Text>
              <Text style={styles.subtitle}>
                N° {receivingNote.fullNumber}
              </Text>
              <Text style={styles.subtitle}>
                Fecha de Recepción: {moment(receivingNote.receptionDate).format('DD/MM/YYYY')}
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

        {/* DOCUMENTO ORIGEN Y ALMACÉN */}
        <View>
          <Text style={styles.sectionTitle}>RECEPCIÓN</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Almacén Destino:</Text>
            <Text style={styles.infoValue}>{warehouse.name}</Text>
          </View>
          {sourceDocument && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Documento Origen:</Text>
              <Text style={styles.infoValue}>
                {sourceDocument.type === 'OC' ? 'Orden de Compra' : 'Factura de Compra'}{' '}
                {sourceDocument.fullNumber}
              </Text>
            </View>
          )}
          {!sourceDocument && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Documento Origen:</Text>
              <Text style={styles.infoValue}>Sin documento asociado</Text>
            </View>
          )}
        </View>

        {/* LÍNEAS DE PRODUCTOS */}
        <View>
          <Text style={styles.sectionTitle}>DETALLE DE PRODUCTOS RECIBIDOS</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.colCode}>Código</Text>
              <Text style={styles.colDesc}>Descripción</Text>
              <Text style={styles.colQty}>Cantidad</Text>
              <Text style={styles.colUnit}>U.M.</Text>
              <Text style={styles.colNotes}>Observaciones</Text>
            </View>

            {lines.map((line, index) => (
              <View key={index} style={styles.tableRow}>
                <Text style={styles.colCode}>{line.productCode || '—'}</Text>
                <Text style={styles.colDesc}>{line.description}</Text>
                <Text style={styles.colQty}>{line.quantity}</Text>
                <Text style={styles.colUnit}>{line.unitOfMeasure || 'UN'}</Text>
                <Text style={styles.colNotes}>{line.notes || '—'}</Text>
              </View>
            ))}
          </View>
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

        {/* FIRMAS */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            <Text>Entregó (Proveedor)</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text>Recibió (Almacén)</Text>
          </View>
        </View>

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
