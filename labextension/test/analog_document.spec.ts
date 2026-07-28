import { describe, expect, it } from 'vitest';

import {
  addSegment,
  addSite,
  createAnalogDocument,
  removeSegment,
  removeSite,
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

  it('restores only current Analog documents', () => {
    const document = createAnalogDocument(() => 'document.analog.test');
    expect(restoreAnalogDocument(document)).toEqual(document);
    expect(restoreAnalogDocument({ ...document, schema_version: '2.0' })).toBeNull();
    expect(restoreAnalogDocument({ ...document, program_kind: 'digital' })).toBeNull();
  });
});
