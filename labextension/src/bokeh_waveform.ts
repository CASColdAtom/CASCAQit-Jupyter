import type { AnalogChannel, AnalogSegment } from './analog_document';

export interface BokehWaveformChannel {
  channel: AnalogChannel;
  segments: AnalogSegment[];
}

export interface BokehViewHandle {
  remove(): void;
}

interface BokehPlot {
  line(x: number[], y: number[], options: Record<string, unknown>): unknown;
}

interface BokehPlottingApi {
  figure(options: Record<string, unknown>): BokehPlot;
  show(
    layout: unknown,
    target: HTMLElement
  ): Promise<BokehViewHandle | BokehViewHandle[]>;
}

const COLORS: Record<AnalogChannel, string> = {
  rabi: '#255bb8',
  detuning: '#a65300',
  phase: '#00796b'
};

const LINE_DASHES: Record<AnalogChannel, string> = {
  rabi: 'solid',
  detuning: 'dashed',
  phase: 'dotdash'
};

export async function renderBokehWaveforms(
  target: HTMLElement,
  channels: BokehWaveformChannel[],
  isCurrent: () => boolean = () => true
): Promise<BokehViewHandle[]> {
  let stage = 'module loading';
  try {
    const core = await import('@bokeh/bokehjs/build/js/bokeh.esm.min.js');
    await import('@bokeh/bokehjs/build/js/bokeh-api.esm.min.js');
    const Bokeh = core.default as { Plotting?: BokehPlottingApi };
    const Plotting = Bokeh.Plotting;
    if (Plotting === undefined) {
      throw new Error('Bokeh standalone plotting API is unavailable.');
    }
    if (!isCurrent()) {
      return [];
    }
    stage = 'figure creation';
    const plot = Plotting.figure({
      title: 'Global controls',
      height: 320,
      sizing_mode: 'stretch_width',
      tools: 'pan,wheel_zoom,box_zoom,reset,save',
      active_scroll: 'wheel_zoom',
      toolbar_location: 'right',
      x_axis_label: 'Time (us)',
      y_axis_label: 'Control value (rad or rad/us)',
      min_border_left: 64,
      min_border_right: 12,
      min_border_top: 32,
      min_border_bottom: 44,
      background_fill_color: '#ffffff',
      border_fill_color: '#ffffff',
      outline_line_color: '#c9cdd3'
    });
    channels.forEach(({ channel, segments }) => {
      stage = `${channel} glyph creation`;
      const points = waveformPoints(segments);
      plot.line(
        points.map(point => point.time),
        points.map(point => point.value),
        {
          line_color: COLORS[channel],
          line_width: 2.5,
          line_cap: 'round',
          line_join: 'round',
          line_dash: LINE_DASHES[channel],
          legend_label: channelLabel(channel)
        }
      );
    });
    stage = 'DOM mounting';
    const view = await Plotting.show(plot, target);
    target.dataset.cascaqitBokehNonempty = 'true';
    target.dataset.cascaqitBokehPlots = '1';
    target.dataset.cascaqitBokehChannels = String(channels.length);
    return Array.isArray(view) ? view : [view];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Bokeh ${stage} failed: ${message}`);
  }
}

function waveformPoints(
  segments: AnalogSegment[]
): Array<{ time: number; value: number }> {
  if (segments.length === 0) {
    return [{ time: 0, value: 0 }];
  }
  const points = [{ time: 0, value: segments[0].start_value }];
  for (const segment of segments) {
    points.push({
      time: points.at(-1)!.time + Math.max(segment.duration, 0),
      value: segment.end_value
    });
  }
  return points;
}

function channelLabel(channel: AnalogChannel): string {
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}
