/**
 * Estilos para PDFs de presupuestos
 * Adaptado de los estilos de facturas, sin secciones de CAE/AFIP
 */

import { StyleSheet } from '@react-pdf/renderer';

export const styles = StyleSheet.create({
  // Página
  page: {
    padding: 30,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },

  // Header con datos de empresa y título
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

  headerRight: {
    flex: 1,
    paddingLeft: 20,
    alignItems: 'flex-end',
  },

  // Título PRESUPUESTO
  quoteTitle: {
    fontSize: 18,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 8,
    textAlign: 'right',
  },

  // Títulos de sección
  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
    marginTop: 10,
  },

  // Datos info (filas label: value)
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

  infoRowRight: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 3,
  },

  infoLabelRight: {
    width: 120,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'right',
  },

  infoValueRight: {
    width: 100,
    textAlign: 'right',
  },

  // Destinatario
  recipientSection: {
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

  // Columnas de tabla (mismos anchos que facturas)
  col1: { width: '5%' }, // #
  col2: { width: '35%' }, // Descripción
  col3: { width: '8%', textAlign: 'right' }, // Cantidad
  col4: { width: '7%', textAlign: 'center' }, // UM
  col5: { width: '10%', textAlign: 'right' }, // P. Unit
  colDto: { width: '7%', textAlign: 'right' }, // Dto.
  col6: { width: '8%', textAlign: 'right' }, // IVA %
  col7: { width: '12%', textAlign: 'right' }, // Subtotal
  col8: { width: '12%', textAlign: 'right' }, // Total

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

  // Condiciones
  conditions: {
    marginTop: 15,
    padding: 10,
    backgroundColor: '#f0f7ff',
    borderLeft: 3,
    borderLeftColor: '#3b82f6',
  },

  conditionsTitle: {
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
  },

  conditionsText: {
    fontSize: 8,
    lineHeight: 1.4,
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

  // Footer
  footer: {
    marginTop: 30,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#ccc',
  },
});
