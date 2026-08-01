import { describe, expect, it } from 'vitest';

import { waveformPoints } from '../src/bokeh_waveform';

describe('Bokeh waveform points', () => {
  it('bounds cumulative time precision', () => {
    expect(
      waveformPoints([
        { id: 's0', duration: 0.1, start_value: 0, end_value: 1 },
        { id: 's1', duration: 0.2, start_value: 1, end_value: 2 },
        { id: 's2', duration: 0.3, start_value: 2, end_value: 0 }
      ]).map(point => point.time)
    ).toEqual([0, 0.1, 0.3, 0.6]);
  });
});
