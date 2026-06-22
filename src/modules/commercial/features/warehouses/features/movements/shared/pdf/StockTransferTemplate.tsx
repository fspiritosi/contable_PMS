import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import moment from 'moment';
import 'moment/locale/es';

import { styles } from './styles';
import type { StockTransferPDFData } from './types';

moment.locale('es');

interface Props {
  data: StockTransferPDFData;
}

export function StockTransferTemplate({ data }: Props) {
  const { company, transfer, sourceWarehouse, destinationWarehouse, lines } = data;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            {company.logoDataUri && (
              <Image src={company.logoDataUri} style={styles.logo} />
            )}
            <View style={styles.headerText}>
              <Text style={styles.title}>TRANSFERENCIA ENTRE ALMACENES</Text>
              <Text style={styles.subtitle}>{transfer.transferNumber}</Text>
            </View>
          </View>
          <Text style={styles.companyInfo}>
            {company.name} | CUIT: {company.taxId} | {company.address}
          </Text>
        </View>

        {/* Info de la transferencia */}
        <View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Fecha:</Text>
            <Text style={styles.infoValue}>{moment(transfer.date).format('DD/MM/YYYY')}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Almacén Origen:</Text>
            <Text style={styles.infoValue}>{sourceWarehouse.code} - {sourceWarehouse.name}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Almacén Destino:</Text>
            <Text style={styles.infoValue}>{destinationWarehouse.code} - {destinationWarehouse.name}</Text>
          </View>
        </View>

        {/* Tabla de productos */}
        <Text style={styles.sectionTitle}>Detalle de Productos</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colCode}>Código</Text>
            <Text style={styles.colDesc}>Producto</Text>
            <Text style={styles.colUnit}>Unidad</Text>
            <Text style={styles.colQty}>Cantidad</Text>
          </View>

          {lines.map((line, index) => (
            <View key={index} style={styles.tableRow}>
              <Text style={styles.colCode}>{line.productCode}</Text>
              <Text style={styles.colDesc}>{line.productName}</Text>
              <Text style={styles.colUnit}>{line.unit || 'UN'}</Text>
              <Text style={styles.colQty}>{line.quantity.toFixed(3)}</Text>
            </View>
          ))}
        </View>

        {/* Notas */}
        {transfer.notes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Observaciones</Text>
            <Text style={styles.notesText}>{transfer.notes}</Text>
          </View>
        )}

        {/* Firmas */}
        <View style={styles.signatureSection}>
          <View style={styles.signatureBox}>
            <Text>Entregó</Text>
          </View>
          <View style={styles.signatureBox}>
            <Text>Recibió</Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer}>
          Generado el {moment().format('DD/MM/YYYY HH:mm')}
        </Text>
      </Page>
    </Document>
  );
}
