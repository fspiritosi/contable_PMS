import { setupClerkTestingToken } from '@clerk/testing/cypress';

describe('Delivery Notes (Remitos de Entrega)', () => {
  beforeEach(() => {
    setupClerkTestingToken();
    cy.visit('/');
    cy.window().should((win) => {
      expect(win).to.have.property('Clerk');
      expect(win.Clerk.loaded).to.eq(true);
    });
    cy.clerkSignIn({
      strategy: 'email_code',
      identifier: Cypress.env('test_user'),
    });
  });

  describe('List Delivery Notes', () => {
    it('should display the delivery notes page', () => {
      cy.visit('/dashboard/commercial/delivery-notes');

      cy.contains('h1', 'Remitos de Entrega').should('be.visible');
      cy.contains('Gestiona la entrega de materiales y productos a clientes').should('be.visible');
    });

    it('should display the delivery notes table', () => {
      cy.visit('/dashboard/commercial/delivery-notes');

      cy.get('[data-testid="data-table"]').should('be.visible');
    });

    it('should have a new delivery note button', () => {
      cy.visit('/dashboard/commercial/delivery-notes');

      cy.contains('a', 'Nuevo Remito').should('be.visible');
    });

    it('should have a invoice delivery notes button', () => {
      cy.visit('/dashboard/commercial/delivery-notes');

      cy.contains('button', 'Facturar Remitos').should('be.visible');
    });

    it('should have status filter', () => {
      cy.visit('/dashboard/commercial/delivery-notes');

      cy.contains('button', 'Estado').should('be.visible');
    });
  });

  describe('Create Delivery Note', () => {
    it('should navigate to create page', () => {
      cy.visit('/dashboard/commercial/delivery-notes');

      cy.contains('a', 'Nuevo Remito').click();

      cy.url().should('include', '/dashboard/commercial/delivery-notes/new');
      cy.contains('Nuevo Remito de Entrega').should('be.visible');
    });

    it('should display form fields', () => {
      cy.visit('/dashboard/commercial/delivery-notes/new');

      cy.contains('Datos Generales').should('be.visible');
      cy.contains('Cliente').should('be.visible');
      cy.contains('Almacén').should('be.visible');
      cy.contains('Fecha de Entrega').should('be.visible');
      cy.contains('Líneas de Entrega').should('be.visible');
      cy.contains('button', 'Agregar Línea').should('be.visible');
      cy.contains('button', 'Crear Remito').should('be.visible');
    });

    it('should add and remove lines', () => {
      cy.visit('/dashboard/commercial/delivery-notes/new');

      // Add a line
      cy.contains('button', 'Agregar Línea').click();
      cy.contains('Línea 1').should('be.visible');
      cy.contains('Producto').should('be.visible');
      cy.contains('Cantidad').should('be.visible');

      // Add another line
      cy.contains('button', 'Agregar Línea').click();
      cy.contains('Línea 2').should('be.visible');

      // Remove second line
      cy.get('button').filter(':has(svg.text-destructive)').last().click();
      cy.contains('Línea 2').should('not.exist');
    });

    it('should show validation errors on empty submit', () => {
      cy.visit('/dashboard/commercial/delivery-notes/new');

      cy.contains('button', 'Crear Remito').click();

      // Should show validation errors
      cy.contains('Selecciona un cliente').should('be.visible');
    });
  });

  describe('Detail View', () => {
    it('should show delivery note detail when clicking a row', () => {
      cy.visit('/dashboard/commercial/delivery-notes');

      cy.get('body').then(($body) => {
        if ($body.find('table tbody tr').length > 0) {
          // Click actions menu on first row
          cy.get('table tbody tr').first().find('button').last().click();
          cy.contains('Ver detalle').click();

          cy.url().should('include', '/dashboard/commercial/delivery-notes/');
          cy.contains('RE-').should('be.visible');
        } else {
          cy.log('No delivery notes found, skipping detail test');
        }
      });
    });
  });

  describe('Invoice from Delivery Notes Dialog', () => {
    it('should open the invoice dialog', () => {
      cy.visit('/dashboard/commercial/delivery-notes');

      cy.contains('button', 'Facturar Remitos').click();

      cy.get('[role="dialog"]').should('be.visible');
      cy.contains('Facturar Remitos de Entrega').should('be.visible');
    });

    it('should show customer selector in dialog', () => {
      cy.visit('/dashboard/commercial/delivery-notes');

      cy.contains('button', 'Facturar Remitos').click();

      cy.get('[role="dialog"]').within(() => {
        cy.contains('Cliente').should('be.visible');
      });
    });
  });
});
