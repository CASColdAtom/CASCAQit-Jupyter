import type { CompileStatus, DocumentIdFactory } from './digital_document';

export type AnalogChannel = 'rabi' | 'detuning' | 'phase';

export interface AnalogSite {
  id: string;
  x: number;
  y: number;
  occupied: boolean;
}

export interface AnalogSegment {
  id: string;
  duration: number;
  start_value: number;
  end_value: number;
}

export interface AnalogModel {
  model_type: 'analog';
  register: {
    coordinate_unit: 'um';
    sites: AnalogSite[];
  };
  controls: Record<AnalogChannel, { segments: AnalogSegment[] }>;
  measurement: { enabled: boolean };
}

export interface AnalogEditorDocument {
  schema_version: '1.0';
  document_id: string;
  revision: number;
  program_kind: 'analog';
  editor_model: AnalogModel;
  generated_source_hash: string | null;
  generated_cell_id: string | null;
  compile_status: CompileStatus;
  source_program_hash: string | null;
  metadata: Record<string, unknown>;
}

export function createAnalogDocument(
  idFactory: DocumentIdFactory = defaultDocumentId
): AnalogEditorDocument {
  return {
    schema_version: '1.0',
    document_id: idFactory(),
    revision: 0,
    program_kind: 'analog',
    editor_model: {
      model_type: 'analog',
      register: {
        coordinate_unit: 'um',
        sites: [
          { id: 's0', x: 0, y: 0, occupied: true },
          { id: 's1', x: 5, y: 0, occupied: true }
        ]
      },
      controls: {
        rabi: {
          segments: [
            { id: 'r0', duration: 0.4, start_value: 0, end_value: 2.5 },
            { id: 'r1', duration: 0.4, start_value: 2.5, end_value: 2.5 },
            { id: 'r2', duration: 0.4, start_value: 2.5, end_value: 0 }
          ]
        },
        detuning: {
          segments: [
            { id: 'd0', duration: 1.2, start_value: -4, end_value: 4 }
          ]
        },
        phase: {
          segments: [
            { id: 'p0', duration: 1.2, start_value: 0, end_value: 0 }
          ]
        }
      },
      measurement: { enabled: true }
    },
    generated_source_hash: null,
    generated_cell_id: null,
    compile_status: 'draft',
    source_program_hash: null,
    metadata: {}
  };
}

export function restoreAnalogDocument(
  value: unknown
): AnalogEditorDocument | null {
  if (!isRecord(value) || !isRecord(value.editor_model)) {
    return null;
  }
  const model = value.editor_model;
  if (
    value.schema_version !== '1.0' ||
    value.program_kind !== 'analog' ||
    typeof value.document_id !== 'string' ||
    value.document_id.length === 0 ||
    !Number.isInteger(value.revision) ||
    model.model_type !== 'analog' ||
    !isRecord(model.register) ||
    !Array.isArray(model.register.sites) ||
    !isRecord(model.controls) ||
    !isChannel(model.controls.rabi) ||
    !isChannel(model.controls.detuning) ||
    !isChannel(model.controls.phase) ||
    !isRecord(model.measurement)
  ) {
    return null;
  }
  return structuredClone(value) as unknown as AnalogEditorDocument;
}

export function addSite(
  document: AnalogEditorDocument,
  site?: Partial<AnalogSite>
): AnalogEditorDocument {
  return edit(document, model => {
    const existing = new Set(model.register.sites.map(item => item.id));
    const id = site?.id?.trim() || nextId(existing, 's');
    const last = model.register.sites.at(-1);
    model.register.sites.push({
      id,
      x: site?.x ?? (last?.x ?? -5) + 5,
      y: site?.y ?? last?.y ?? 0,
      occupied: site?.occupied ?? true
    });
  });
}

export function updateSite(
  document: AnalogEditorDocument,
  index: number,
  update: Partial<AnalogSite>
): AnalogEditorDocument {
  return edit(document, model => {
    const site = model.register.sites[index];
    if (site !== undefined) {
      model.register.sites[index] = {
        ...site,
        ...update,
        id: update.id === undefined ? site.id : update.id.trim()
      };
    }
  });
}

export function removeSite(
  document: AnalogEditorDocument,
  index: number
): AnalogEditorDocument {
  if (document.editor_model.register.sites.length <= 1) {
    return document;
  }
  return edit(document, model => {
    model.register.sites.splice(index, 1);
  });
}

export function addSegment(
  document: AnalogEditorDocument,
  channel: AnalogChannel
): AnalogEditorDocument {
  return edit(document, model => {
    const segments = model.controls[channel].segments;
    const previous = segments.at(-1);
    const value = previous?.end_value ?? 0;
    const prefix = channel.charAt(0);
    const id = nextId(new Set(segments.map(item => item.id)), prefix);
    segments.push({
      id,
      duration: previous?.duration ?? 0.4,
      start_value: value,
      end_value: value
    });
  });
}

export function updateSegment(
  document: AnalogEditorDocument,
  channel: AnalogChannel,
  index: number,
  update: Partial<AnalogSegment>
): AnalogEditorDocument {
  return edit(document, model => {
    const segment = model.controls[channel].segments[index];
    if (segment !== undefined) {
      model.controls[channel].segments[index] = {
        ...segment,
        ...update,
        id: update.id === undefined ? segment.id : update.id.trim()
      };
    }
  });
}

export function removeSegment(
  document: AnalogEditorDocument,
  channel: AnalogChannel,
  index: number
): AnalogEditorDocument {
  if (document.editor_model.controls[channel].segments.length <= 1) {
    return document;
  }
  return edit(document, model => {
    model.controls[channel].segments.splice(index, 1);
  });
}

export function setAnalogMeasurement(
  document: AnalogEditorDocument,
  enabled: boolean
): AnalogEditorDocument {
  return edit(document, model => {
    model.measurement.enabled = enabled;
  });
}

export function withAnalogCompileResult(
  value: unknown,
  fallback: AnalogEditorDocument
): AnalogEditorDocument {
  return restoreAnalogDocument(value) ?? fallback;
}

function edit(
  document: AnalogEditorDocument,
  update: (model: AnalogModel) => void
): AnalogEditorDocument {
  const next = structuredClone(document);
  update(next.editor_model);
  next.revision += 1;
  next.compile_status = 'draft';
  return next;
}

function nextId(existing: Set<string>, prefix: string): string {
  let index = existing.size;
  while (existing.has(`${prefix}${index}`)) {
    index += 1;
  }
  return `${prefix}${index}`;
}

function isChannel(value: unknown): boolean {
  return isRecord(value) && Array.isArray(value.segments);
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function defaultDocumentId(): string {
  return `document.analog.${globalThis.crypto.randomUUID()}`;
}
