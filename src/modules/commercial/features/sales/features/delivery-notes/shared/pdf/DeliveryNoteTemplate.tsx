import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { styles } from './styles';
import type { DeliveryNotePDFData } from './types';
import moment from 'moment';

interface Props {
  data: DeliveryNotePDFData;
}

export function DeliveryNoteTemplate({ data }: Props) {
  const { company, deliveryNote, customer, warehouse, sourceInvoice, lines, notes } = data;

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
              <Text style={styles.title}>REMITO DE ENTREGA</Text>
              <Text style={styles.subtitle}>N° {deliveryNote.fullNumber}</Text>
              <Text style={styles.subtitle}>
                Fecha de Entrega: {moment(deliveryNote.deliveryDate).format('DD/MM/YYYY')}
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

        {/* DATOS DEL CLIENTE */}
        <View>
          <Text style={styles.sectionTitle}>CLIENTE</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Nombre / Razón Social:</Text>
            <Text style={styles.infoValue}>{customer.name}</Text>
          </View>
          {customer.taxId && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>CUIT:</Text>
              <Text style={styles.infoValue}>{customer.taxId}</Text>
            </View>
          )}
          {customer.address && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Domicilio:</Text>
              <Text style={styles.infoValue}>{customer.address}</Text>
            </View>
          )}
          {customer.phone && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Teléfono:</Text>
              <Text style={styles.infoValue}>{customer.phone}</Text>
            </View>
          )}
        </View>

        {/* ENTREGA */}
        <View>
          <Text style={styles.sectionTitle}>ENTREGA</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Almacén Origen:</Text>
            <Text style={styles.infoValue}>{warehouse.name}</Text>
          </View>
          {sourceInvoice && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Factura Asociada:</Text>
              <Text style={styles.infoValue}>{sourceInvoice.fullNumber}</Text>
            </View>
          )}
        </View>

        {/* LÍNEAS DE PRODUCTOS */}
        <View>
          <Text style={styles.sectionTitle}>DETALLE DE PRODUCTOS ENTREGADOS</Text>
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

        {/* FIRMAS */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            <Text>Despachó (Almacén)</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text>Recibió (Cliente)</Text>
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
