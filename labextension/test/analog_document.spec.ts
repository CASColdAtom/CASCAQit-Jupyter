import { describe, expect, it } from 'vitest';

import {
  applyRegisterLayout,
  addSegment,
  addSite,
  createAnalogDocument,
  removeSegment,
  removeSite,
  registerLayout,
  restoreAnalogDocument,
  setAnalogMeasurement,
  updateSegment,
  updateSite
} from '../src/analog_document';

describe('Analog editor document', () => {
  it('edits register sites while preserving immutable revision history', () => {
    const initial = createAnalogDocument(() => 'document.analog.test');
    let document = addSite(initial);
    document = updateSite(document, 2, {
      id: 'ancilla',
      x: 10,
      y: 2,
      occupied: false
    });

    expect(document.revision).toBe(2);
    expect(document.editor_model.register.sites[2]).toEqual({
      id: 'ancilla',
      x: 10,
      y: 2,
      occupied: false
    });
    expect(initial.editor_model.register.sites).toHaveLength(2);

    document = removeSite(document, 2);
    expect(document.editor_model.register.sites).toHaveLength(2);
  });

  it('edits waveform segments and terminal measurement', () => {
    let document = createAnalogDocument(() => 'document.analog.test');
    document = addSegment(document, 'detuning');
    document = updateSegment(document, 'detuning', 1, {
      duration: 0.5,
      end_value: 7
    });
    document = setAnalogMeasurement(document, false);

    expect(document.editor_model.controls.detuning.segments[1]).toMatchObject({
      start_value: 4,
      duration: 0.5,
      end_value: 7
    });
    expect(document.editor_model.measurement.enabled).toBe(false);

    document = removeSegment(document, 'detuning', 1);
    expect(document.editor_model.controls.detuning.segments).toHaveLength(1);
  });

  it.each([
    ['line', { atom_count: 4, spacing_x: 6 }, 4],
    ['rectangle', { rows: 2, columns: 3, spacing_x: 5, spacing_y: 7 }, 6],
    ['triangle', { rows: 3, columns: 2, spacing_x: 5 }, 6],
    ['ring', { atom_count: 8, radius: 10 }, 8],
    ['hexagonal', { rings: 2, spacing_x: 5 }, 19]
  ] as const)('generates a deterministic %s register', (shape, update, count) => {
    const initial = createAnalogDocument(() => 'document.analog.test');
    const layout = { ...registerLayout(initial), ...update, shape };
    const first = applyRegisterLayout(initial, layout);
    const second = applyRegisterLayout(initial, layout);

    expect(first.editor_model.register.sites).toEqual(
      second.editor_model.register.sites
    );
    expect(first.editor_model.register.sites).toHaveLength(count);
    expect(first.editor_model.register.layout_tool).toEqual(layout);
    expect(new Set(first.editor_model.register.sites.map(site => site.id)).size)
      .toBe(count);
  });

  it('centers generated sites and returns to custom after point editing', () => {
    const initial = createAnalogDocument(() => 'document.analog.test');
    const generated = applyRegisterLayout(initial, {
      ...registerLayout(initial),
      shape: 'rectangle',
      rows: 2,
      columns: 2,
      spacing_x: 6,
      spacing_y: 8,
      center_x: 10,
      center_y: -4
    });
    const xs = generated.editor_model.register.sites.map(site => site.x);
    const ys = generated.editor_model.register.sites.map(site => site.y);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([7, 13]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([-8, 0]);

    const edited = updateSite(generated, 0, { x: 8 });
    expect(registerLayout(edited).shape).toBe('custom');
  });

  it('restores only current Analog documents', () => {
    const document = createAnalogDocument(() => 'document.analog.test');
    expect(restoreAnalogDocument(document)).toEqual(document);
    expect(restoreAnalogDocument({ ...document, schema_version: '2.0' })).toBeNull();
    expect(restoreAnalogDocument({ ...document, program_kind: 'digital' })).toBeNull();
  });
});
