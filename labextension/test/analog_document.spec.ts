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
    ['square', { spacing_x: 6 }, 4],
    ['rectangle', { rows: 2, columns: 3, spacing_x: 5, spacing_y: 7 }, 6],
    ['triangle', { rows: 3, columns: 2, spacing_x: 5 }, 6],
    ['ring', { atom_count: 8, radius: 10 }, 8],
    ['hexagonal', { rings: 2, spacing_x: 5 }, 19]
  ] as const)('generates a deterministic %s register', (shape, update, count) => {
    let initial = createAnalogDocument(() => 'document.analog.test');
    for (let index = 2; index < count; index += 1) {
      initial = addSite(initial, { id: `site-${index}` });
    }
    const layout = { ...registerLayout(initial), ...update, shape };
    const first = applyRegisterLayout(initial, layout);
    const second = applyRegisterLayout(initial, layout);

    expect(first.editor_model.register.sites).toEqual(
      second.editor_model.register.sites
    );
    expect(first.editor_model.register.sites).toHaveLength(count);
    expect(new Set(first.editor_model.register.sites.map(site => site.id)).size)
      .toBe(count);
  });

  it('centers generated sites and returns to custom after point editing', () => {
    let initial = createAnalogDocument(() => 'document.analog.test');
    initial = addSite(initial);
    initial = addSite(initial);
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

  it('preserves manually added sites when redeploying a layout', () => {
    const initial = createAnalogDocument(() => 'document.analog.test');
    const added = addSite(initial, {
      id: 'ancilla',
      x: 12,
      y: 3,
      occupied: false
    });

    const deployed = applyRegisterLayout(added, {
      ...registerLayout(added),
      shape: 'line'
    });

    expect(deployed.editor_model.register.sites).toHaveLength(3);
    expect(deployed.editor_model.register.layout_tool).toMatchObject({
      shape: 'line',
      atom_count: 3
    });
    expect(deployed.editor_model.register.sites[2]).toMatchObject({
      id: 'ancilla',
      occupied: false
    });
  });

  it('does not fill unused fixed-grid positions with new sites', () => {
    let document = createAnalogDocument(() => 'document.analog.test');
    for (let index = 2; index < 7; index += 1) {
      document = addSite(document, { id: `site-${index}` });
    }

    const deployed = applyRegisterLayout(document, {
      ...registerLayout(document),
      shape: 'rectangle',
      rows: 2,
      columns: 3
    });

    expect(deployed.editor_model.register.sites).toHaveLength(7);
    expect(deployed.editor_model.register.layout_tool).toMatchObject({
      rows: 2,
      columns: 4
    });
    expect(deployed.editor_model.register.sites.slice(0, 7).map(site => site.id))
      .toEqual(['s0', 's1', 'site-2', 'site-3', 'site-4', 'site-5', 'site-6']);
  });

  it('arranges four sites as a centered square without changing membership', () => {
    let document = createAnalogDocument(() => 'document.analog.test');
    document = addSite(document, { id: 's2' });
    document = addSite(document, { id: 's3', occupied: false });

    const deployed = applyRegisterLayout(document, {
      ...registerLayout(document),
      shape: 'square',
      spacing_x: 6,
      center_x: 10,
      center_y: -4
    });

    expect(deployed.editor_model.register.sites).toEqual([
      { id: 's0', x: 7, y: -7, occupied: true },
      { id: 's1', x: 13, y: -7, occupied: true },
      { id: 's2', x: 7, y: -1, occupied: true },
      { id: 's3', x: 13, y: -1, occupied: false }
    ]);
    expect(deployed.editor_model.register.layout_tool).toMatchObject({
      shape: 'square',
      rows: 2,
      columns: 2
    });
  });

  it('preserves sites beyond a layout schema capacity', () => {
    let document = createAnalogDocument(() => 'document.analog.test');
    for (let index = 2; index < 101; index += 1) {
      document = addSite(document, { id: `site-${index}` });
    }

    const deployed = applyRegisterLayout(document, {
      ...registerLayout(document),
      shape: 'line'
    });

    expect(deployed.editor_model.register.sites).toHaveLength(101);
    expect(deployed.editor_model.register.layout_tool?.atom_count).toBe(100);
    expect(deployed.editor_model.register.sites[100].id).toBe('site-100');
  });

  it('restores only current Analog documents', () => {
    const document = createAnalogDocument(() => 'document.analog.test');
    expect(restoreAnalogDocument(document)).toEqual(document);
    expect(restoreAnalogDocument({ ...document, schema_version: '2.0' })).toBeNull();
    expect(restoreAnalogDocument({ ...document, program_kind: 'digital' })).toBeNull();
  });
});
