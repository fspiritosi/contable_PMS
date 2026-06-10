'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import type { DocumentState } from '@/generated/prisma/enums';
import { getDocumentStateBadge } from '@/shared/utils/mappers';
import { formatDate } from '@/shared/utils/formatters';

import type { ModulePermissions } from '@/shared/lib/permissions';

import {
  getCompanyDocuments,
  getCompanyDocumentsSummary,
  type CompanyDocumentListItem,
  type CompanyDocumentsSummary,
} from '../actions.server';
import { deleteCompanyDocument } from '../../upload/actions.server';

// ============================================
// TIPOS
// ============================================

interface Props {
  initialData: CompanyDocumentListItem[];
  initialSummary: CompanyDocumentsSummary;
  permissions: ModulePermissions;
}

// ============================================
// HELPERS
// ============================================

const stateIcons: Record<DocumentState, React.ReactNode> = {
  PENDING: <Clock className="h-4 w-4" />,
  APPROVED: <CheckCircle2 className="h-4 w-4" />,
  EXPIRED: <AlertCircle className="h-4 w-4" />,
};

// ============================================
// COMPONENT
// ============================================

export function _CompanyDocumentsGrid({ initialData, initialSummary, permissions }: Props) {
  const queryClient = useQueryClient();

  const { data: documents } = useQuery({
    queryKey: ['companyDocuments'],
    queryFn: () => getCompanyDocuments(),
    initialData,
  });

  const { data: summary } = useQuery({
    queryKey: ['companyDocumentsSummary'],
    queryFn: () => getCompanyDocumentsSummary(),
    initialData: initialSummary,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteCompanyDocument(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companyDocuments'] });
      queryClient.invalidateQueries({ queryKey: ['companyDocumentsSummary'] });
      toast.success('Documento eliminado');
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Error al eliminar documento'
      );
    },
  });

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="company-documents-summary"
      >
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Documentos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.total}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Obligatorios Completados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.mandatoryCompleted}/{summary.mandatory}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Aprobados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {summary.approved}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Vencidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {summary.expired}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Documents Grid */}
      <Card>
        <CardHeader>
          <CardTitle>Documentos de Empresa</CardTitle>
          <CardDescription>
            Gestiona los documentos corporativos
          </CardDescription>
        </CardHeader>
        <CardContent>
          {documents.length === 0 ? (
            <div
              className="py-8 text-center text-muted-foreground"
              data-testid="company-documents-empty"
            >
              <FileText className="mx-auto h-12 w-12 opacity-50" />
              <p className="mt-2">No hay documentos registrados</p>
            </div>
          ) : (
            <div
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="company-documents-grid"
            >
              {documents.map((doc) => {
                const badgeConfig = getDocumentStateBadge(doc.state, doc.documentType.hasExpiration);
                return (
                  <Card key={doc.id} className="relative">
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <CardTitle className="text-base">
                            {doc.documentType.name}
                          </CardTitle>
                          {doc.period && (
                            <CardDescription>
                              Periodo: {doc.period}
                            </CardDescription>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              data-testid={`company-document-menu-${doc.id}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {doc.documentKey && (
                              <>
                                <DropdownMenuItem
                                  onClick={() =>
                                    window.open(
                                      `/api/storage/${doc.documentKey}`,
                                      '_blank',
                                      'noopener,noreferrer'
                                    )
                                  }
                                >
                                  <Eye className="mr-2 h-4 w-4" />
                                  Ver documento
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    window.open(
                                      `/api/storage/${doc.documentKey}?download=true`,
                                      '_blank',
                                      'noopener,noreferrer'
                                    )
                                  }
                                >
                                  <Download className="mr-2 h-4 w-4" />
                                  Descargar
                                </DropdownMenuItem>
                                {permissions.canDelete && <DropdownMenuSeparator />}
                              </>
                            )}
                            {permissions.canDelete && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() => deleteMutation.mutate(doc.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Eliminar
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center gap-2">
                        {stateIcons[doc.state]}
                        <Badge variant={badgeConfig.variant}>
                          {badgeConfig.label}
                        </Badge>
                        {doc.documentType.isMandatory && (
                          <Badge variant="outline">Obligatorio</Badge>
                        )}
                      </div>

                      {doc.expirationDate && (
                        <p className="text-sm text-muted-foreground">
                          Vence: {formatDate(doc.expirationDate)}
                        </p>
                      )}

                      {doc.fileName && (
                        <p className="truncate text-sm text-muted-foreground">
                          {doc.fileName}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
