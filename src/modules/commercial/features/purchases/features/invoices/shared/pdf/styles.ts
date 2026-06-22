/**
 * Estilos para PDFs de facturas de compra
 * Basado en los estilos de facturas de venta
 */

import { StyleSheet } from '@react-pdf/renderer';

export const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 9,
    fontFamily: 'Helvetica',
  },

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

  sectionTitle: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 5,
    marginTop: 10,
  },

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

  supplierSection: {
    marginTop: 15,
    marginBottom: 15,
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 3,
  },

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

  col1: { width: '8%' },
  col2: { width: '35%' },
  col3: { width: '8%', textAlign: 'right' },
  col4: { width: '7%', textAlign: 'center' },
  col5: { width: '10%', textAlign: 'right' },
  col6: { width: '8%', textAlign: 'right' },
  col7: { width: '12%', textAlign: 'right' },
  col8: { width: '12%', textAlign: 'right' },

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

  smallText: {
    fontSize: 7,
    color: '#666',
  },

  bold: {
    fontFamily: 'Helvetica-Bold',
  },
});
