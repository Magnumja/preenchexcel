import { z } from 'zod';
export const fieldTypes = [
  'text',
  'longtext',
  'number',
  'currency',
  'date',
  'datetime',
  'boolean',
  'select',
  'multiselect',
  'reference',
] as const;
export const typeLabels: Record<(typeof fieldTypes)[number], string> = {
  text: 'Texto curto',
  longtext: 'Texto longo',
  number: 'Número',
  currency: 'Valor monetário',
  date: 'Data',
  datetime: 'Data e hora',
  boolean: 'Sim / não',
  select: 'Seleção',
  multiselect: 'Múltipla seleção',
  reference: 'Referência',
};
export const valueSchema = z.union([
  z.string().max(10000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(500)).max(100),
  z.null(),
]);
export type Value = z.infer<typeof valueSchema>;
export const fieldSchema = z.object({
  id: z.string().regex(/^c\d+$/),
  source: z.string().max(500),
  label: z.string().trim().min(1).max(100),
  type: z.enum(fieldTypes),
  required: z.boolean(),
  readonly: z.boolean(),
  group: z.string().max(100).default('Informações gerais'),
  options: z.array(z.string().max(500)).max(200).default([]),
  currency: z.enum(['BRL', 'USD', 'EUR']).default('BRL'),
  reference: z
    .object({ sheetId: z.string().max(100), fieldId: z.string().regex(/^c\d+$/) })
    .optional(),
  // Ao atualizar um conjunto existente: campo do conjunto que recebe esta coluna.
  target: z
    .string()
    .regex(/^c\d+$/)
    .optional(),
});
export type Field = z.infer<typeof fieldSchema>;
export const mappingSchema = z.object({
  sheetId: z.string().max(100),
  name: z.string().trim().min(1).max(100),
  role: z.enum(['records', 'lookup', 'report', 'exclude']),
  headerRow: z.number().int().min(1).max(10001),
  endRow: z.number().int().min(1).max(10001),
  startColumn: z.number().int().min(1).max(100),
  endColumn: z.number().int().min(1).max(100),
  keyField: z
    .string()
    .regex(/^c\d+$/)
    .nullable(),
  titleField: z.string().regex(/^c\d+$/),
  fields: z.array(fieldSchema).min(1).max(100),
  // Reconciliação: atualiza este conjunto em vez de criar um novo. Registros ausentes no arquivo
  // são mantidos; edições feitas no Preenche só são sobrescritas com `conflicts: 'file'`.
  datasetId: z.string().uuid().optional(),
  conflicts: z.enum(['keep', 'file']).default('keep'),
});
export type Mapping = z.infer<typeof mappingSchema>;
export const confirmSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(500).default(''),
    projectId: z.string().uuid().optional(),
    locale: z.enum(['pt-BR', 'en-US']).default('pt-BR'),
    acknowledged: z.literal(true),
    mappings: z.array(mappingSchema).min(1).max(20),
  })
  .strict();
export type Confirmation = z.infer<typeof confirmSchema>;
export interface Cell {
  value: Value;
  formula?: string;
}
export interface Sheet {
  id: string;
  file: string;
  name: string;
  rows: Cell[][];
  warnings: string[];
}
export interface Diagnosis {
  sheets: Sheet[];
  mappings: Mapping[];
  warnings: string[];
}
export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  datasetCount: number;
  recordCount: number;
}
export interface Dataset {
  id: string;
  projectId: string;
  name: string;
  role: string;
  fields: Field[];
  keyField: string | null;
  titleField: string;
  schemaVersion: number;
  recordCount: number;
  sourceUrl?: string | null;
  syncEnabled?: boolean;
  syncState?: SyncState | null;
  /** Nome original da aba de origem, quando o conjunto veio de um link. */
  sourceSheet?: string | null;
}
export interface DataRecord {
  id: string;
  datasetId: string;
  values: Record<string, Value>;
  version: number;
  updatedAt: string;
  deletedAt?: string | null;
  source: {
    file: string;
    sheet: string;
    row: number;
    region: string;
    mappingVersion: number;
    original: Record<string, Value>;
    /** Versão do registro na última importação; maior que `version` atual = editado no Preenche. */
    importedVersion?: number;
  };
}
export interface SyncState {
  /** Quem ativou a sincronização; autoria das alterações aplicadas por ela. */
  userId: string;
  lastRunAt?: string;
  status?: 'ok' | 'error';
  message?: string;
  plan?: ReconcilePlan;
}
export interface ReconcilePlan {
  inserts: number;
  updates: number;
  unchanged: number;
  conflicts: string[];
  missing: string[];
}
export interface Workspace {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
}
export type RevisionAction = 'import' | 'edit' | 'delete' | 'restore';
export interface Revision {
  id: string;
  author: string;
  createdAt: string;
  version: number;
  action: RevisionAction;
  before: Record<string, Value> | null;
  after: Record<string, Value>;
}
