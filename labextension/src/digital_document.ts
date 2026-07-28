export type CompileStatus =
  | 'draft'
  | 'invalid'
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'detached';

export interface DigitalQubit {
  id: string;
  label?: string;
}

export interface DigitalGate {
  id: string;
  gate: string;
  targets: string[];
  parameters: Record<string, number | string>;
}

export interface DigitalModel {
  model_type: 'digital';
  qubits: DigitalQubit[];
  gates: DigitalGate[];
  measurement: {
    terminal: boolean;
    key: string;
  };
}

export interface DigitalEditorDocument {
  schema_version: '1.0';
  document_id: string;
  revision: number;
  program_kind: 'digital';
  editor_model: DigitalModel;
  generated_source_hash: string | null;
  generated_cell_id: string | null;
  compile_status: CompileStatus;
  source_program_hash: string | null;
  metadata: Record<string, unknown>;
}

export interface GateInput {
  gate: string;
  targets: string[];
  parameters?: Record<string, number | string>;
}

export type DocumentIdFactory = () => string;

export function createDigitalDocument(
  idFactory: DocumentIdFactory = defaultDocumentId
): DigitalEditorDocument {
  return {
    schema_version: '1.0',
    document_id: idFactory(),
    revision: 0,
    program_kind: 'digital',
    editor_model: {
      model_type: 'digital',
      qubits: [{ id: 'q0' }, { id: 'q1' }],
      gates: [],
      measurement: { terminal: true, key: 'm' }
    },
    generated_source_hash: null,
    generated_cell_id: null,
    compile_status: 'draft',
    source_program_hash: null,
    metadata: {}
  };
}

export function restoreDigitalDocument(
  value: unknown
): DigitalEditorDocument | null {
  if (!isRecord(value)) {
    return null;
  }
  const model = value.editor_model;
  if (
    value.schema_version !== '1.0' ||
    value.program_kind !== 'digital' ||
    typeof value.document_id !== 'string' ||
    value.document_id.length === 0 ||
    !Number.isInteger(value.revision) ||
    !isRecord(model) ||
    model.model_type !== 'digital' ||
    !Array.isArray(model.qubits) ||
    !Array.isArray(model.gates) ||
    !isRecord(model.measurement)
  ) {
    return null;
  }
  return structuredClone(value) as unknown as DigitalEditorDocument;
}

export function addQubit(
  document: DigitalEditorDocument,
  requestedId?: string
): DigitalEditorDocument {
  const existing = new Set(document.editor_model.qubits.map(item => item.id));
  const id = requestedId?.trim() || nextQubitId(existing);
  return edit(document, model => {
    model.qubits.push({ id });
  });
}

export function renameQubit(
  document: DigitalEditorDocument,
  index: number,
  id: string
): DigitalEditorDocument {
  return edit(document, model => {
    const previous = model.qubits[index]?.id;
    if (previous === undefined) {
      return;
    }
    model.qubits[index].id = id.trim();
    for (const gate of model.gates) {
      gate.targets = gate.targets.map(target => (target === previous ? id.trim() : target));
    }
  });
}

export function removeQubit(
  document: DigitalEditorDocument,
  index: number
): DigitalEditorDocument {
  if (document.editor_model.qubits.length <= 1) {
    return document;
  }
  return edit(document, model => {
    const [removed] = model.qubits.splice(index, 1);
    if (removed !== undefined) {
      model.gates = model.gates.filter(gate => !gate.targets.includes(removed.id));
    }
  });
}

export function addGate(
  document: DigitalEditorDocument,
  input: GateInput
): DigitalEditorDocument {
  const gate = input.gate.trim().toLowerCase();
  const targets = input.targets.map(item => item.trim()).filter(Boolean);
  return edit(document, model => {
    model.gates.push({
      id: nextGateId(model.gates),
      gate,
      targets,
      parameters: structuredClone(input.parameters ?? {})
    });
  });
}

export function removeGate(
  document: DigitalEditorDocument,
  index: number
): DigitalEditorDocument {
  return edit(document, model => {
    model.gates.splice(index, 1);
  });
}

export function moveGate(
  document: DigitalEditorDocument,
  index: number,
  direction: -1 | 1
): DigitalEditorDocument {
  const target = index + direction;
  if (target < 0 || target >= document.editor_model.gates.length) {
    return document;
  }
  return edit(document, model => {
    const [gate] = model.gates.splice(index, 1);
    model.gates.splice(target, 0, gate);
  });
}

export function setMeasurement(
  document: DigitalEditorDocument,
  terminal: boolean,
  key: string
): DigitalEditorDocument {
  return edit(document, model => {
    model.measurement = { terminal, key: key.trim() };
  });
}

export function withCompileResult(
  value: unknown,
  fallback: DigitalEditorDocument
): DigitalEditorDocument {
  return restoreDigitalDocument(value) ?? fallback;
}

function edit(
  document: DigitalEditorDocument,
  update: (model: DigitalModel) => void
): DigitalEditorDocument {
  const next = structuredClone(document);
  update(next.editor_model);
  next.revision += 1;
  next.compile_status = 'draft';
  return next;
}

function nextQubitId(existing: Set<string>): string {
  let index = 0;
  while (existing.has(`q${index}`)) {
    index += 1;
  }
  return `q${index}`;
}

function nextGateId(gates: DigitalGate[]): string {
  const existing = new Set(gates.map(item => item.id));
  let index = gates.length;
  while (existing.has(`g${index}`)) {
    index += 1;
  }
  return `g${index}`;
}

function defaultDocumentId(): string {
  return `document.digital.${globalThis.crypto.randomUUID()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
