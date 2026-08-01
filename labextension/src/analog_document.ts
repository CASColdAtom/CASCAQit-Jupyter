import type { CompileStatus, DocumentIdFactory } from './digital_document';

export type AnalogChannel = 'rabi' | 'detuning' | 'phase';
export const ANALOG_DERIVED_DECIMAL_PLACES = 6;
export type AnalogRegisterShape =
  | 'custom'
  | 'line'
  | 'square'
  | 'rectangle'
  | 'triangle'
  | 'ring'
  | 'hexagonal';

export interface AnalogRegisterLayout {
  shape: AnalogRegisterShape;
  atom_count: number;
  rows: number;
  columns: number;
  spacing_x: number;
  spacing_y: number;
  radius: number;
  rings: number;
  center_x: number;
  center_y: number;
}

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
    layout_tool?: AnalogRegisterLayout;
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
        layout_tool: defaultRegisterLayout(),
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
    markRegisterCustom(model);
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
    markRegisterCustom(model);
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
    markRegisterCustom(model);
    model.register.sites.splice(index, 1);
  });
}

export function applyRegisterLayout(
  document: AnalogEditorDocument,
  value: AnalogRegisterLayout
): AnalogEditorDocument {
  return edit(document, model => {
    const layout = layoutForSiteCount(
      normalizeRegisterLayout(value),
      model.register.sites.length
    );
    model.register.layout_tool = layout;
    if (layout.shape !== 'custom') {
      model.register.sites = sitesForLayout(layout, model.register.sites);
    }
  });
}

export function registerLayout(
  document: AnalogEditorDocument
): AnalogRegisterLayout {
  const value = document.editor_model.register.layout_tool;
  return value === undefined
    ? { ...defaultRegisterLayout(), shape: 'custom' }
    : normalizeRegisterLayout(value);
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

function defaultRegisterLayout(): AnalogRegisterLayout {
  return {
    shape: 'line',
    atom_count: 2,
    rows: 2,
    columns: 3,
    spacing_x: 5,
    spacing_y: 5,
    radius: 8,
    rings: 1,
    center_x: 2.5,
    center_y: 0
  };
}

function normalizeRegisterLayout(
  value: AnalogRegisterLayout
): AnalogRegisterLayout {
  return {
    shape: value.shape,
    atom_count: integerInRange(value.atom_count, 1, 100, 2),
    rows: integerInRange(value.rows, 1, 20, 2),
    columns: integerInRange(value.columns, 1, 20, 3),
    spacing_x: positiveFinite(value.spacing_x, 5),
    spacing_y: positiveFinite(value.spacing_y, 5),
    radius: positiveFinite(value.radius, 8),
    rings: integerInRange(value.rings, 1, 20, 1),
    center_x: finite(value.center_x, 0),
    center_y: finite(value.center_y, 0)
  };
}

function layoutForSiteCount(
  layout: AnalogRegisterLayout,
  siteCount: number
): AnalogRegisterLayout {
  const fitted = { ...layout };
  fitted.atom_count = Math.min(100, siteCount);
  if (fitted.shape === 'square') {
    fitted.columns = Math.min(20, Math.ceil(Math.sqrt(siteCount)));
    fitted.rows = Math.min(20, Math.ceil(siteCount / fitted.columns));
    fitted.spacing_y = fitted.spacing_x;
  } else if (fitted.shape === 'rectangle') {
    if (fitted.rows * fitted.columns < siteCount) {
      fitted.columns = Math.min(
        20,
        Math.max(fitted.columns, Math.ceil(siteCount / fitted.rows))
      );
    }
    if (fitted.rows * fitted.columns < siteCount) {
      fitted.rows = Math.min(
        20,
        Math.max(fitted.rows, Math.ceil(siteCount / fitted.columns))
      );
    }
  } else if (fitted.shape === 'triangle') {
    fitted.rows = Math.min(20, triangularRowsForCount(siteCount));
    fitted.columns = fitted.rows;
    fitted.spacing_y = fitted.spacing_x * Math.sqrt(3) / 2;
  } else if (fitted.shape === 'hexagonal') {
    fitted.rings = 1;
    while (fitted.rings < 20 && hexagonalSiteCount(fitted.rings) < siteCount) {
      fitted.rings += 1;
    }
  }
  return fitted;
}

function sitesForLayout(
  layout: AnalogRegisterLayout,
  existingSites: AnalogSite[] = []
): AnalogSite[] {
  const siteCount = existingSites.length;
  let coordinates: Array<[number, number]>;
  switch (layout.shape) {
    case 'line':
      coordinates = Array.from({ length: siteCount }, (_, index) => [
        index * layout.spacing_x,
        0
      ]);
      break;
    case 'square':
      coordinates = rectangularCoordinates(
        siteCount,
        layout.columns,
        layout.spacing_x,
        layout.spacing_x
      );
      break;
    case 'rectangle':
      coordinates = rectangularCoordinates(
        siteCount,
        layout.columns,
        layout.spacing_x,
        layout.spacing_y
      );
      break;
    case 'triangle':
      coordinates = triangularCoordinatesForCount(
        siteCount,
        layout.spacing_x
      );
      break;
    case 'ring':
      coordinates = Array.from({ length: siteCount }, (_, index) => {
        const angle = (2 * Math.PI * index) / siteCount;
        return [
          layout.radius * Math.cos(angle),
          layout.radius * Math.sin(angle)
        ];
      });
      break;
    case 'hexagonal':
      coordinates = hexagonalCoordinatesForCount(siteCount, layout.spacing_x);
      break;
    case 'custom':
      return [];
  }
  const centered = centerCoordinates(coordinates, layout.center_x, layout.center_y);
  return centered.map(([x, y], index) => ({
    ...existingSites[index],
    x: roundAnalogDerived(x),
    y: roundAnalogDerived(y)
  }));
}

function rectangularCoordinates(
  count: number,
  columns: number,
  spacingX: number,
  spacingY: number
): Array<[number, number]> {
  return Array.from({ length: count }, (_, index) => [
    (index % columns) * spacingX,
    Math.floor(index / columns) * spacingY
  ]);
}

function triangularRowsForCount(count: number): number {
  return Math.ceil((Math.sqrt(8 * count + 1) - 1) / 2);
}

function triangularCoordinatesForCount(
  count: number,
  spacing: number
): Array<[number, number]> {
  const coordinates: Array<[number, number]> = [];
  const verticalSpacing = Math.sqrt(3) * spacing / 2;
  for (let row = 0; coordinates.length < count; row += 1) {
    for (
      let column = 0;
      column <= row && coordinates.length < count;
      column += 1
    ) {
      coordinates.push([column * spacing, row * verticalSpacing]);
    }
  }
  return coordinates;
}

function hexagonalCoordinates(rings: number, spacing: number): Array<[number, number]> {
  const axial: Array<[number, number]> = [];
  for (let q = -rings; q <= rings; q += 1) {
    for (let r = -rings; r <= rings; r += 1) {
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) <= rings) {
        axial.push([q, r]);
      }
    }
  }
  axial.sort((left, right) => {
    const leftRing = Math.max(Math.abs(left[0]), Math.abs(left[1]), Math.abs(-left[0] - left[1]));
    const rightRing = Math.max(Math.abs(right[0]), Math.abs(right[1]), Math.abs(-right[0] - right[1]));
    return leftRing - rightRing || left[1] - right[1] || left[0] - right[0];
  });
  return axial.map(([q, r]) => [
    spacing * (q + r / 2),
    spacing * Math.sqrt(3) * r / 2
  ]);
}

function hexagonalSiteCount(rings: number): number {
  return 1 + 3 * rings * (rings + 1);
}

function hexagonalCoordinatesForCount(
  count: number,
  spacing: number
): Array<[number, number]> {
  let rings = 1;
  while (hexagonalSiteCount(rings) < count) {
    rings += 1;
  }
  return hexagonalCoordinates(rings, spacing).slice(0, count);
}

function centerCoordinates(
  coordinates: Array<[number, number]>,
  centerX: number,
  centerY: number
): Array<[number, number]> {
  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);
  const offsetX = centerX - (Math.min(...xs) + Math.max(...xs)) / 2;
  const offsetY = centerY - (Math.min(...ys) + Math.max(...ys)) / 2;
  return coordinates.map(([x, y]) => [x + offsetX, y + offsetY]);
}

function markRegisterCustom(model: AnalogModel): void {
  model.register.layout_tool = {
    ...(model.register.layout_tool ?? defaultRegisterLayout()),
    shape: 'custom'
  };
}

function integerInRange(
  value: number,
  minimum: number,
  maximum: number,
  fallback: number
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function positiveFinite(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

export function roundAnalogDerived(value: number): number {
  const rounded = Number(value.toFixed(ANALOG_DERIVED_DECIMAL_PLACES));
  return Object.is(rounded, -0) ? 0 : rounded;
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
