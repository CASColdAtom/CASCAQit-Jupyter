import { describe, expect, it } from 'vitest';

import {
  addGate,
  addQubit,
  createDigitalDocument,
  moveGate,
  removeQubit,
  renameQubit,
  restoreDigitalDocument,
  setMeasurement
} from '../src/digital_document';

describe('Digital editor document', () => {
  it('maintains a monotonic revision and preserves generated association', () => {
    const initial = {
      ...createDigitalDocument(() => 'document.digital.test'),
      generated_cell_id: 'cell-1',
      generated_source_hash: 'a'.repeat(64),
      compile_status: 'ready' as const
    };

    const edited = addGate(initial, {
      gate: 'h',
      targets: ['q0']
    });

    expect(edited.revision).toBe(1);
    expect(edited.compile_status).toBe('draft');
    expect(edited.generated_cell_id).toBe('cell-1');
    expect(edited.generated_source_hash).toBe('a'.repeat(64));
    expect(initial.editor_model.gates).toEqual([]);
  });

  it('supports qubit editing, gate ordering, parameters, and measurement', () => {
    let document = createDigitalDocument(() => 'document.digital.test');
    document = addQubit(document);
    document = renameQubit(document, 2, 'ancilla');
    document = addGate(document, { gate: 'h', targets: ['q0'] });
    document = addGate(document, {
      gate: 'rx',
      targets: ['ancilla'],
      parameters: { theta: 0.5 }
    });
    document = moveGate(document, 1, -1);
    document = setMeasurement(document, true, 'result');

    expect(document.editor_model.qubits.map(item => item.id)).toEqual([
      'q0',
      'q1',
      'ancilla'
    ]);
    expect(document.editor_model.gates.map(item => item.gate)).toEqual([
      'rx',
      'h'
    ]);
    expect(document.editor_model.gates[0].parameters).toEqual({ theta: 0.5 });
    expect(document.editor_model.measurement.key).toBe('result');

    document = removeQubit(document, 2);
    expect(document.editor_model.gates.map(item => item.gate)).toEqual(['h']);
  });

  it('restores only current Digital documents', () => {
    const document = createDigitalDocument(() => 'document.digital.test');
    expect(restoreDigitalDocument(document)).toEqual(document);
    expect(restoreDigitalDocument({ ...document, schema_version: '2.0' })).toBeNull();
    expect(restoreDigitalDocument({ ...document, program_kind: 'analog' })).toBeNull();
  });
});
