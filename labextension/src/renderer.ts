import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { Widget } from '@lumino/widgets';

const MIME_TYPES = [
  'application/vnd.cascaqit.program+json',
  'application/vnd.cascaqit.result+json',
  'application/vnd.cascaqit.diagnostics+json',
  'application/vnd.cascaqit.visualization+json'
];
const MIME_KINDS: Record<string, string> = {
  [MIME_TYPES[0]]: 'program',
  [MIME_TYPES[1]]: 'result',
  [MIME_TYPES[2]]: 'diagnostics',
  [MIME_TYPES[3]]: 'visualization'
};

const SVG_NS = 'http://www.w3.org/2000/svg';
type JsonRecord = Record<string, unknown>;

export class CASCAQitRenderer extends Widget implements IRenderMime.IRenderer {
  constructor(options: IRenderMime.IRendererOptions) {
    super();
    this.mimeType = options.mimeType;
    this.addClass('cascaqit-Renderer');
  }

  async renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    renderPayload(this.node, this.mimeType, model.data[this.mimeType]);
  }

  private readonly mimeType: string;
}

export function renderPayload(
  root: HTMLElement,
  mimeType: string,
  value: unknown
): void {
  root.replaceChildren();
  root.classList.add('cascaqit-Renderer');

  if (!isPayload(value) || MIME_KINDS[mimeType] !== value.kind) {
    renderError(root, 'Invalid CASCAQit MIME payload');
    return;
  }

  root.append(renderHeader(value));
  if (value.kind === 'program') {
    renderProgram(root, value.data);
  } else if (value.kind === 'result') {
    renderResult(root, value.data);
  } else if (value.kind === 'diagnostics') {
    renderDiagnostics(root, asArray(value.data.items));
  } else {
    renderVisualization(root, value.data);
  }
}

interface Payload {
  protocol_version: string;
  kind: 'program' | 'result' | 'diagnostics' | 'visualization';
  source: { id: string; hash: string };
  data: JsonRecord;
}

function renderHeader(payload: Payload): HTMLElement {
  const header = element('header', 'cascaqit-Renderer-header');
  const titleGroup = element('div');
  const eyebrow = element('div', 'cascaqit-Renderer-eyebrow');
  eyebrow.textContent = 'CASCAQit';
  const title = element('h3', 'cascaqit-Renderer-title');
  title.textContent = titleCase(payload.kind);
  titleGroup.append(eyebrow, title);

  const identity = element('div', 'cascaqit-Renderer-identity');
  const source = element('span');
  source.textContent = payload.source.id;
  const hash = element('code');
  hash.textContent = payload.source.hash.slice(0, 12);
  identity.append(source, hash);
  header.append(titleGroup, identity);
  return header;
}

function renderProgram(root: HTMLElement, data: JsonRecord): void {
  const programType = text(data.program_type, 'unknown');
  root.append(
    metricStrip([
      ['Program type', programType],
      ['Schema', text(data.schema_version, 'unknown')],
      ['Lifecycle', text(data.lifecycle_state, text(data.validation_mode, 'n/a'))]
    ])
  );
  if (programType === 'digital') {
    renderDigitalProgram(root, data);
  } else if (programType === 'analog') {
    renderAnalogProgram(root, data);
  } else if (programType === 'hybrid') {
    root.append(renderHybridTimeline(asArray(data.blocks), true));
  } else {
    renderEmpty(root, 'No supported program view is available.');
  }
}

function renderDigitalProgram(root: HTMLElement, data: JsonRecord): void {
  const circuit = record(data.circuit);
  const qubits = asArray(circuit.qubits).map(value => text(value, '?'));
  const gates = asArray(circuit.gates).map(record);
  const measurements = asArray(circuit.measurements).map(record);
  if (qubits.length === 0) {
    renderEmpty(root, 'The Digital program has no qubits.');
    return;
  }

  const section = viewSection('Circuit', `${qubits.length} qubits | ${gates.length} gates`);
  const viewport = element('div', 'cascaqit-Renderer-circuitViewport');
  const width = Math.max(560, 150 + (gates.length + 1) * 82);
  const height = 54 + qubits.length * 48;
  const svg = createSvg(width, height, 'Digital quantum circuit');
  svg.dataset.testid = 'digital-circuit';

  qubits.forEach((qubit, index) => {
    const y = 48 + index * 48;
    svg.append(
      svgText(16, y + 5, qubit, 'cascaqit-Svg-label'),
      svgLine(72, y, width - 24, y, 'cascaqit-Svg-wire')
    );
  });

  gates.forEach((gate, gateIndex) => {
    const x = 112 + gateIndex * 82;
    const targets = asArray(gate.targets).map(value => text(value, ''));
    const name = text(gate.name, '?').toUpperCase();
    const targetIndexes = targets
      .map(target => qubits.indexOf(target))
      .filter(index => index >= 0);
    if (targetIndexes.length === 0) {
      return;
    }
    if (name === 'CX' && targetIndexes.length >= 2) {
      const controlY = 48 + targetIndexes[0] * 48;
      const targetY = 48 + targetIndexes[1] * 48;
      svg.append(
        svgLine(x, controlY, x, targetY, 'cascaqit-Svg-connector'),
        svgCircle(x, controlY, 5, 'cascaqit-Svg-control'),
        svgCircle(x, targetY, 15, 'cascaqit-Svg-target'),
        svgLine(x - 8, targetY, x + 8, targetY, 'cascaqit-Svg-targetLine'),
        svgLine(x, targetY - 8, x, targetY + 8, 'cascaqit-Svg-targetLine')
      );
      return;
    }
    const first = Math.min(...targetIndexes);
    const last = Math.max(...targetIndexes);
    if (last > first) {
      svg.append(
        svgLine(x, 48 + first * 48, x, 48 + last * 48, 'cascaqit-Svg-connector')
      );
    }
    targetIndexes.forEach(index => appendGate(svg, x, 48 + index * 48, name));
  });

  const measureX = 112 + gates.length * 82;
  const measured = new Set(
    measurements.flatMap(item => asArray(item.targets).map(value => text(value, '')))
  );
  qubits.forEach((qubit, index) => {
    if (measured.has(qubit)) {
      appendGate(svg, measureX, 48 + index * 48, 'M', true);
    }
  });
  viewport.append(svg);
  section.append(viewport);
  root.append(section);
}

function renderAnalogProgram(root: HTMLElement, data: JsonRecord): void {
  const layout = element('div', 'cascaqit-Renderer-domainGrid');
  const register = record(data.register);
  const sites = asArray(register.sites).map(site => {
    const item = record(site);
    const position = asArray(item.position);
    return {
      ...item,
      x: number(position[0], 0),
      y: number(position[1], 0),
      filled: text(item.status, '') === 'filled'
    };
  });
  layout.append(
    renderRegisterPlot(sites, text(register.coordinate_unit, 'um'), 'Atom register')
  );

  const terms = record(record(data.hamiltonian).terms);
  const channels: JsonRecord[] = [];
  for (const channelId of ['rabi', 'detuning']) {
    channels.push(waveformChannel(channelId, record(terms[channelId])));
  }
  if (typeof terms.phase === 'number') {
    const duration = Math.max(
      ...channels.flatMap(channel => channelPoints(channel).map(point => point.time)),
      1
    );
    channels.push({
      channel_id: 'phase',
      value_unit: 'rad',
      segments: [{ start: 0, stop: duration, value: terms.phase }]
    });
  } else if (isRecord(terms.phase)) {
    channels.push(waveformChannel('phase', terms.phase));
  }
  layout.append(renderPulsePlot(channels, 'us', 'Global controls'));
  root.append(layout);
}

function renderResult(root: HTMLElement, data: JsonRecord): void {
  const counts = record(data.counts);
  const bars = Object.entries(counts)
    .map(([bitstring, value]) => ({ bitstring, count: number(value, 0) }))
    .sort((left, right) => right.count - left.count || left.bitstring.localeCompare(right.bitstring));
  const bitOrdering = record(data.bit_ordering);
  const metadata = record(data.metadata);
  root.append(
    metricStrip([
      ['Shots', String(number(data.shots, 0))],
      ['Target', text(data.target_id, 'unknown')],
      ['Seed', scalar(metadata.seed, 'n/a')],
      ['Result ID', text(data.result_id, 'unknown')],
      ['Program hash', shortHash(data.program_hash)],
      ['Bit order', formatBitOrdering(bitOrdering)],
      ['Observed states', String(bars.length)]
    ]),
    renderCountsPlot(bars, number(data.shots, 0), 'Measurement counts')
  );

  const probabilities = Object.entries(record(data.probabilities))
    .map(([state, value]) => [state, formatProbability(number(value, 0))] as [string, string])
    .sort((left, right) => left[0].localeCompare(right[0]));
  if (probabilities.length > 0) {
    root.append(renderDataTable('Probabilities', probabilities));
  }

  const observables = Object.entries(record(data.observables)).flatMap(
    ([group, value]) => Object.entries(record(value)).map(
      ([name, sample]) => [`${group} / ${name}`, formatNumber(number(sample, 0))] as [string, string]
    )
  );
  if (observables.length > 0) {
    root.append(renderDataTable('Observables', observables));
  }

  const boundary: Array<[string, string]> = [
    ['Backend', text(metadata.backend_id, 'unknown')],
    ['Network accessed', yesNo(metadata.network_accessed)],
    ['Offline deterministic', yesNo(metadata.offline_deterministic)],
    ['Execution package created', yesNo(metadata.execution_package_created)]
  ];
  if (boundary.some(([, value]) => value !== 'n/a' && value !== 'unknown')) {
    root.append(renderDataTable('Execution boundary', boundary));
  }

  const estimate = record(metadata.simulation_resource_estimate);
  const usage = record(metadata.simulation_resource_usage);
  const resources: Array<[string, string]> = [
    ['Method', text(estimate.method, text(record(metadata.simulation_plan).method_selected, 'n/a'))],
    ['Logical sites', scalar(estimate.logical_sites, 'n/a')],
    ['Hilbert dimension', scalar(estimate.hilbert_dimension, 'n/a')],
    ['Estimated peak', formatBytes(estimate.estimated_peak_bytes)],
    ['Actual peak RSS', formatBytes(usage.actual_peak_rss_bytes)],
    ['Incremental peak RSS', formatBytes(usage.incremental_peak_rss_bytes)],
    ['Wall time', formatSeconds(usage.wall_time_seconds)],
    ['Measurement scope', text(usage.measurement_scope, 'n/a')]
  ];
  if (resources.some(([, value]) => value !== 'n/a')) {
    root.append(renderDataTable('Simulation resources', resources));
  }
  const diagnostics = asArray(data.diagnostics);
  if (diagnostics.length > 0) {
    renderDiagnostics(root, diagnostics, 'Execution diagnostics');
  }
}

function renderDataTable(
  title: string,
  rows: Array<[string, string]>
): HTMLElement {
  const section = viewSection(title, `${rows.length} fields`);
  const table = element('table', 'cascaqit-Renderer-dataTable');
  const body = document.createElement('tbody');
  rows.slice(0, 64).forEach(([label, value]) => {
    const row = document.createElement('tr');
    const key = document.createElement('th');
    key.scope = 'row';
    key.textContent = label;
    const detail = document.createElement('td');
    detail.textContent = value;
    row.append(key, detail);
    body.append(row);
  });
  table.append(body);
  section.append(table);
  return section;
}

function renderDiagnostics(
  root: HTMLElement,
  values: unknown[],
  title = 'Diagnostics'
): void {
  const section = viewSection(title, `${values.length} messages`);
  const list = element('div', 'cascaqit-Renderer-diagnostics');
  if (values.length === 0) {
    const empty = element('p', 'cascaqit-Renderer-empty');
    empty.textContent = 'No diagnostics.';
    list.append(empty);
  }
  values.forEach(value => {
    const diagnostic = record(value);
    const severity = text(diagnostic.severity, 'info');
    const row = element('article', 'cascaqit-Diagnostic');
    row.dataset.severity = severity;
    const marker = element('div', 'cascaqit-Diagnostic-marker');
    marker.textContent = severityLabel(severity);
    const content = element('div');
    const heading = element('div', 'cascaqit-Diagnostic-heading');
    const code = element('code');
    code.textContent = text(diagnostic.code, 'UNKNOWN');
    const path = element('span');
    path.textContent = text(diagnostic.object_path, 'Unscoped');
    heading.append(code, path);
    const message = element('p');
    message.textContent = text(diagnostic.message, 'No message supplied.');
    content.append(heading, message);
    const suggestionValue = text(diagnostic.suggestion, '');
    if (suggestionValue) {
      const suggestion = element('p', 'cascaqit-Diagnostic-suggestion');
      suggestion.textContent = suggestionValue;
      content.append(suggestion);
    }
    row.append(marker, content);
    list.append(row);
  });
  section.append(list);
  root.append(section);
}

function renderVisualization(root: HTMLElement, data: JsonRecord): void {
  const spec = record(data.spec);
  const kind = text(spec.visualization_kind, 'unknown');
  const title = text(spec.title, 'Visualization');
  if (kind === 'counts_histogram') {
    const bars = asArray(data.bars).map(value => {
      const item = record(value);
      return {
        bitstring: text(item.bitstring, '?'),
        count: number(item.count, 0)
      };
    });
    root.append(renderCountsPlot(bars, number(data.shots, 0), title));
  } else if (kind === 'register') {
    root.append(
      renderRegisterPlot(
        asArray(data.sites).map(record),
        text(data.coordinate_unit, 'um'),
        title
      )
    );
  } else if (kind === 'pulse_timeline') {
    root.append(
      renderPulsePlot(asArray(data.channels).map(record), text(data.time_unit, 'us'), title)
    );
  } else if (kind === 'hybrid_timeline') {
    root.append(renderHybridTimeline(asArray(data.blocks), Boolean(data.plan_only), title));
  } else {
    renderEmpty(root, 'No supported visualization view is available.');
  }
}

function renderCountsPlot(
  bars: Array<{ bitstring: string; count: number }>,
  shots: number,
  title: string
): HTMLElement {
  const section = viewSection(title, `${shots} shots`);
  if (bars.length === 0) {
    const empty = element('p', 'cascaqit-Renderer-empty');
    empty.textContent = 'No count data.';
    section.append(empty);
    return section;
  }
  const visible = bars.slice(0, 32);
  const width = Math.max(520, visible.length * 54 + 80);
  const height = 260;
  const svg = createSvg(width, height, title);
  svg.dataset.testid = 'counts-chart';
  const maxCount = Math.max(...visible.map(item => item.count), 1);
  const baseline = 210;
  const plotHeight = 150;
  svg.append(
    svgLine(52, baseline, width - 20, baseline, 'cascaqit-Svg-axis'),
    svgLine(52, 40, 52, baseline, 'cascaqit-Svg-axis')
  );
  visible.forEach((item, index) => {
    const slot = (width - 90) / visible.length;
    const barWidth = Math.min(34, slot * 0.7);
    const x = 62 + index * slot + (slot - barWidth) / 2;
    const barHeight = (Math.max(item.count, 0) / maxCount) * plotHeight;
    const rect = svgRect(x, baseline - barHeight, barWidth, barHeight, 'cascaqit-Svg-bar');
    rect.dataset.value = String(item.count);
    svg.append(
      rect,
      svgText(x + barWidth / 2, baseline - barHeight - 7, String(item.count), 'cascaqit-Svg-value'),
      svgText(x + barWidth / 2, baseline + 22, item.bitstring, 'cascaqit-Svg-tick')
    );
  });
  section.append(svgViewport(svg));
  return section;
}

function renderRegisterPlot(
  sites: JsonRecord[],
  unit: string,
  title: string
): HTMLElement {
  const section = viewSection(title, `${sites.length} sites | ${unit}`);
  const svg = createSvg(480, 280, title);
  svg.dataset.testid = 'register-plot';
  const points = sites.map(site => {
    const position = asArray(site.position);
    return {
      id: text(site.site_id, '?'),
      x: number(site.x, number(position[0], 0)),
      y: number(site.y, number(position[1], 0)),
      filled: bool(site.filled, text(site.status, '') === 'filled')
    };
  });
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  const [xMin, xMax] = extent(xs);
  const [yMin, yMax] = extent(ys);
  svg.append(
    svgLine(48, 232, 448, 232, 'cascaqit-Svg-axis'),
    svgLine(48, 28, 48, 232, 'cascaqit-Svg-axis'),
    svgText(450, 254, `x (${unit})`, 'cascaqit-Svg-axisLabel'),
    svgText(18, 24, `y (${unit})`, 'cascaqit-Svg-axisLabel')
  );
  points.forEach(point => {
    const x = scale(point.x, xMin, xMax, 76, 424);
    const y = scale(point.y, yMin, yMax, 204, 52);
    svg.append(
      svgCircle(
        x,
        y,
        12,
        point.filled ? 'cascaqit-Svg-siteFilled' : 'cascaqit-Svg-siteVacant'
      ),
      svgText(x, y + 29, point.id, 'cascaqit-Svg-tick')
    );
  });
  section.append(svgViewport(svg));
  return section;
}

function renderPulsePlot(channels: JsonRecord[], unit: string, title: string): HTMLElement {
  const section = viewSection(title, `${channels.length} channels | ${unit}`);
  const height = Math.max(180, 70 + channels.length * 92);
  const svg = createSvg(640, height, title);
  svg.dataset.testid = 'pulse-plot';
  channels.forEach((channel, index) => {
    const points = channelPoints(channel);
    const yTop = 34 + index * 92;
    const channelId = text(channel.channel_id, `channel ${index + 1}`);
    const valueUnit = text(channel.value_unit, '');
    svg.append(
      svgText(12, yTop + 22, channelId, 'cascaqit-Svg-label'),
      svgText(12, yTop + 39, valueUnit, 'cascaqit-Svg-unit'),
      svgLine(104, yTop + 50, 616, yTop + 50, 'cascaqit-Svg-axis')
    );
    if (points.length === 0) {
      return;
    }
    const times = points.map(point => point.time);
    const values = points.map(point => point.value);
    const [timeMin, timeMax] = extent(times);
    const [valueMin, valueMax] = extent(values);
    const path = points
      .map((point, pointIndex) => {
        const x = scale(point.time, timeMin, timeMax, 112, 608);
        const y = scale(point.value, valueMin, valueMax, yTop + 72, yTop + 16);
        return `${pointIndex === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
    const line = svgElement('path');
    line.setAttribute('d', path);
    line.setAttribute('class', `cascaqit-Svg-wave cascaqit-Svg-wave-${index % 3}`);
    svg.append(line);
  });
  section.append(svgViewport(svg));
  return section;
}

function renderHybridTimeline(
  values: unknown[],
  planOnly: boolean,
  title = 'Hybrid timeline'
): HTMLElement {
  const section = viewSection(title, planOnly ? 'Plan only' : 'Execution timeline');
  const blocks = element('div', 'cascaqit-Renderer-blocks');
  values.forEach((value, index) => {
    const block = record(value);
    const item = element('div', 'cascaqit-HybridBlock');
    const order = element('span');
    order.textContent = String(index + 1);
    const content = element('div');
    const name = element('strong');
    name.textContent = text(block.block_id, text(block.id, `Block ${index + 1}`));
    const kind = element('span');
    kind.textContent = text(block.block_type, text(block.program_kind, 'unknown'));
    content.append(name, kind);
    item.append(order, content);
    blocks.append(item);
  });
  if (values.length === 0) {
    const empty = element('p', 'cascaqit-Renderer-empty');
    empty.textContent = 'No timeline blocks.';
    blocks.append(empty);
  }
  section.append(blocks);
  return section;
}

function channelPoints(channel: JsonRecord): Array<{ time: number; value: number }> {
  const points = asArray(channel.points).map(value => {
    const point = record(value);
    return { time: number(point.time, 0), value: number(point.value, 0) };
  });
  if (points.length > 0) {
    return points;
  }
  return asArray(channel.segments).flatMap(value => {
    const segment = record(value);
    const start = number(segment.start, 0);
    const stop = number(segment.stop, start);
    const sample = number(segment.value, 0);
    return [
      { time: start, value: sample },
      { time: stop, value: sample }
    ];
  });
}

function waveformChannel(channelId: string, waveform: JsonRecord): JsonRecord {
  const times = asArray(waveform.times);
  const values = asArray(waveform.values);
  const points = times.map((time, index) => ({ time, value: values[index] }));
  if (points.length > 0) {
    return {
      channel_id: channelId,
      value_unit: waveform.value_unit,
      points
    };
  }

  const duration = number(waveform.duration, 0);
  if (values.length === 1 && duration > 0) {
    return {
      channel_id: channelId,
      value_unit: waveform.value_unit,
      segments: [{ start: 0, stop: duration, value: values[0] }]
    };
  }
  return { channel_id: channelId, value_unit: waveform.value_unit, points: [] };
}

function metricStrip(rows: Array<[string, string]>): HTMLElement {
  const list = element('dl', 'cascaqit-Renderer-metrics');
  rows.forEach(([label, value]) => {
    const item = element('div');
    const term = element('dt');
    term.textContent = label;
    const detail = element('dd');
    detail.textContent = value;
    item.append(term, detail);
    list.append(item);
  });
  return list;
}

function viewSection(title: string, detail: string): HTMLElement {
  const section = element('section', 'cascaqit-Renderer-section');
  const heading = element('div', 'cascaqit-Renderer-sectionHeading');
  const name = element('h4');
  name.textContent = title;
  const meta = element('span');
  meta.textContent = detail;
  heading.append(name, meta);
  section.append(heading);
  return section;
}

function renderEmpty(root: HTMLElement, message: string): void {
  const empty = element('p', 'cascaqit-Renderer-empty');
  empty.textContent = message;
  root.append(empty);
}

function renderError(root: HTMLElement, message: string): void {
  const error = element('div', 'cascaqit-Renderer-error');
  error.setAttribute('role', 'alert');
  error.textContent = message;
  root.append(error);
}

function svgViewport(svg: SVGSVGElement): HTMLElement {
  const viewport = element('div', 'cascaqit-Renderer-svgViewport');
  viewport.append(svg);
  return viewport;
}

function createSvg(width: number, height: number, title: string): SVGSVGElement {
  const svg = svgElement('svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', title);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.dataset.cascaqitNonempty = 'true';
  const titleNode = svgElement('title');
  titleNode.textContent = title;
  svg.append(titleNode);
  return svg;
}

function appendGate(
  svg: SVGSVGElement,
  x: number,
  y: number,
  name: string,
  measurement = false
): void {
  svg.append(
    svgRect(x - 19, y - 17, 38, 34, measurement ? 'cascaqit-Svg-measure' : 'cascaqit-Svg-gate'),
    svgText(x, y + 5, name, 'cascaqit-Svg-gateText')
  );
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  name: K
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function svgLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className: string
): SVGLineElement {
  const line = svgElement('line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.setAttribute('class', className);
  return line;
}

function svgRect(
  x: number,
  y: number,
  width: number,
  height: number,
  className: string
): SVGRectElement {
  const rect = svgElement('rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(Math.max(width, 0)));
  rect.setAttribute('height', String(Math.max(height, 0)));
  rect.setAttribute('rx', '3');
  rect.setAttribute('class', className);
  return rect;
}

function svgCircle(
  cx: number,
  cy: number,
  radius: number,
  className: string
): SVGCircleElement {
  const circle = svgElement('circle');
  circle.setAttribute('cx', String(cx));
  circle.setAttribute('cy', String(cy));
  circle.setAttribute('r', String(radius));
  circle.setAttribute('class', className);
  return circle;
}

function svgText(
  x: number,
  y: number,
  value: string,
  className: string
): SVGTextElement {
  const label = svgElement('text');
  label.setAttribute('x', String(x));
  label.setAttribute('y', String(y));
  label.setAttribute('class', className);
  label.textContent = value;
  return label;
}

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (className) {
    node.className = className;
  }
  return node;
}

function isPayload(value: unknown): value is Payload {
  if (!isRecord(value) || !isRecord(value.source) || !isRecord(value.data)) {
    return false;
  }
  return (
    value.protocol_version === '1.0' &&
    ['program', 'result', 'diagnostics', 'visualization'].includes(text(value.kind, '')) &&
    typeof value.source.id === 'string' &&
    typeof value.source.hash === 'string'
  );
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function number(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function scalar(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}

function yesNo(value: unknown): string {
  return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : 'n/a';
}

function shortHash(value: unknown): string {
  const hash = text(value, 'unknown');
  return hash === 'unknown' ? hash : hash.slice(0, 16);
}

function formatProbability(value: number): string {
  return `${(value * 100).toFixed(4).replace(/\.?0+$/, '')}%`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toPrecision(8);
}

function formatBytes(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 'n/a';
  }
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let size = value / 1024;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[index]}`;
}

function formatSeconds(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(4)} s`
    : 'n/a';
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}

function formatBitOrdering(value: JsonRecord): string {
  const convention = text(value.convention, 'unspecified');
  const order = text(value.qubits, text(value.atom_order, ''));
  return order ? `${convention} | ${order}` : convention;
}

function severityLabel(severity: string): string {
  if (severity === 'error') {
    return 'Error';
  }
  if (severity === 'warning') {
    return 'Warning';
  }
  return 'Info';
}

function extent(values: number[]): [number, number] {
  if (values.length === 0) {
    return [0, 1];
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  if (minimum === maximum) {
    return [minimum - 0.5, maximum + 0.5];
  }
  return [minimum, maximum];
}

function scale(
  value: number,
  sourceMin: number,
  sourceMax: number,
  targetMin: number,
  targetMax: number
): number {
  const ratio = (value - sourceMin) / (sourceMax - sourceMin || 1);
  return targetMin + ratio * (targetMax - targetMin);
}

const rendererFactory: IRenderMime.IRendererFactory = {
  safe: true,
  mimeTypes: MIME_TYPES,
  createRenderer: options => new CASCAQitRenderer(options)
};

const extension: IRenderMime.IExtension = {
  id: '@cascaqit/jupyter:renderer',
  rendererFactory,
  rank: 60,
  dataType: 'json'
};

export default extension;
