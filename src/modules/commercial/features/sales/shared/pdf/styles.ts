/**
 * Estilos compartidos para PDFs de facturas
 */

import { StyleSheet, Font } from '@react-pdf/renderer';

// Registrar fuentes (opcional - usar fuentes del sistema por defecto)
// Font.register({
//   family: 'Roboto',
//   src: '/fonts/Roboto-Regular.ttf'
// });

export const styles = StyleSheet.create({
  // Página
  page: {
    padding: 30,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },

  // Header con logo y datos de empresa
  header: {
    flexDirection: 'row',
    marginBottom: 20,
    borderBottom: 1,
    borderBottomColor: '#000',
    paddingBottom: 10,
  },

  headerLeft: {
    flex: 1,
  },

  logo: {
    width: 60,
    height: 60,
    objectFit: 'contain',
    marginBottom: 6,
  },

  headerCenter: {
    width: 80,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeft: 1,
    borderRight: 1,
    borderColor: '#000',
    paddingHorizontal: 10,
  },

  headerRight: {
    flex: 1,
    paddingLeft: 10,
  },

  // Tipo de factura (A/B/C)
  invoiceType: {
    fontSize: 48,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
  },

  invoiceTypeLabel: {
    fontSize: 8,
    textAlign: 'center',
    marginTop: 2,
  },

  // Títulos de sección
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
    marginTop: 10,
  },

  // Datos de empresa y cliente
  infoRow: {
    flexDirection: 'row',
    marginBottom: 3,
  },

  infoLabel: {
    width: 100,
    fontFamily: 'Helvetica-Bold',
  },

  infoValue: {
    flex: 1,
  },

  // Cliente/Receptor
  customerSection: {
    marginTop: 15,
    marginBottom: 15,
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 3,
  },

  // Tabla de productos
  table: {
    marginTop: 10,
    marginBottom: 10,
  },

  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: '#000',
    paddingBottom: 5,
    marginBottom: 5,
    fontFamily: 'Helvetica-Bold',
  },

  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: '#ccc',
    paddingVertical: 5,
  },

  // Columnas de tabla
  col1: { width: '8%' },   // Código
  col2: { width: '35%' },  // Descripción
  col3: { width: '8%', textAlign: 'right' },   // Cantidad
  col4: { width: '7%', textAlign: 'center' },  // UM
  col5: { width: '10%', textAlign: 'right' },  // P. Unit
  colDto: { width: '7%', textAlign: 'right' }, // Dto.
  col6: { width: '8%', textAlign: 'right' },   // IVA %
  col7: { width: '12%', textAlign: 'right' },  // Subtotal
  col8: { width: '12%', textAlign: 'right' },  // Total

  // Totales
  totalsSection: {
    marginTop: 20,
    marginLeft: 'auto',
    width: '45%',
  },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },

  totalLabel: {
    fontFamily: 'Helvetica-Bold',
  },

  totalValue: {
    textAlign: 'right',
    minWidth: 80,
  },

  grandTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    marginTop: 5,
    borderTopWidth: 2,
    borderTopColor: '#000',
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },

  // Footer con CAE
  footer: {
    marginTop: 30,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#ccc',
  },

  caeSection: {
    marginTop: 10,
    padding: 10,
    backgroundColor: '#f0f0f0',
  },

  caeRow: {
    flexDirection: 'row',
    marginBottom: 3,
  },

  caeLabel: {
    width: 120,
    fontFamily: 'Helvetica-Bold',
  },

  caeValue: {
    flex: 1,
    fontFamily: 'Courier',
  },

  // Observaciones
  notes: {
    marginTop: 15,
    padding: 10,
    backgroundColor: '#fffbf0',
    borderLeft: 3,
    borderLeftColor: '#f0ad4e',
  },

  notesTitle: {
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
  },

  notesText: {
    fontSize: 8,
    lineHeight: 1.4,
  },

  // Textos pequeños
  smallText: {
    fontSize: 7,
    color: '#666',
  },

  // Bold
  bold: {
    fontFamily: 'Helvetica-Bold',
  },
});
