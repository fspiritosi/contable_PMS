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
  const {
    themeConfig,
    headerText,
    footerText,
    notesDefault,
    showIssuer = true,
    showNotes = true,
    company,
    transfer,
    sourceWarehouse,
    destinationWarehouse,
    lines,
  } = data;

  const effectiveNotes = transfer.notes || notesDefault;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View
          style={[
            styles.header,
            {
              borderBottomColor: themeConfig.borderColor,
              borderBottomWidth: themeConfig.headerBorderWidth,
            },
          ]}
        >
          <View style={styles.headerTop}>
            {company.logoDataUri && (
              <Image src={company.logoDataUri} style={styles.logo} />
            )}
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: themeConfig.primaryColor }]}>
                TRANSFERENCIA ENTRE ALMACENES
              </Text>
              <Text style={styles.subtitle}>{transfer.transferNumber}</Text>
            </View>
          </View>
          {showIssuer && (
            <Text style={styles.companyInfo}>
              {company.name} | CUIT: {company.taxId} | {company.address}
            </Text>
          )}
          {headerText && (
            <Text style={{ marginTop: 8, fontSize: 8, fontStyle: 'italic', textAlign: 'center' }}>
              {headerText}
            </Text>
          )}
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

        {/* Tabla de ítems */}
        <Text style={styles.sectionTitle}>Detalle de Ítems</Text>
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colCode}>Código</Text>
            <Text style={styles.colDesc}>Ítem</Text>
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
        {showNotes && effectiveNotes && (
          <View style={styles.notes}>
            <Text style={styles.notesTitle}>Observaciones</Text>
            <Text style={styles.notesText}>{effectiveNotes}</Text>
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
        <View style={styles.footer}>
          {footerText && <Text style={{ marginBottom: 2 }}>{footerText}</Text>}
          <Text>Generado el {moment().format('DD/MM/YYYY HH:mm')}</Text>
        </View>
      </Page>
    </Document>
  );
}
