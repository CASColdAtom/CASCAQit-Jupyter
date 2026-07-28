import type { NotebookPanel } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';

import {
  AnalogChannel,
  AnalogEditorDocument,
  AnalogSegment,
  AnalogSite,
  addSegment,
  addSite,
  createAnalogDocument,
  removeSegment,
  removeSite,
  setAnalogMeasurement,
  updateSegment,
  updateSite,
  withAnalogCompileResult
} from './analog_document';
import { KernelClient } from './kernel_client';
import { JobController } from './job_controller';
import { renderJobView } from './job_view';
import { CompilePayload, NotebookBridge } from './notebook_bridge';
import type { CommResponse, ProtocolError } from './protocol';

const CHANNELS: AnalogChannel[] = ['rabi', 'detuning', 'phase'];

interface AnalogDiagnostic {
  code: string | null;
  message: string;
  objectPath: string | null;
  suggestion: string | null;
}

export interface AnalogEditorOptions {
  panel: () => NotebookPanel | null;
  bridge?: NotebookBridge;
  client?: KernelClient;
  documentId?: () => string;
}

export class AnalogEditorWidget extends Widget {
  constructor(options: AnalogEditorOptions) {
    super();
    this.panel = options.panel;
    this.bridge = options.bridge ?? new NotebookBridge();
    this.client = options.client ?? new KernelClient();
    this.documentId = options.documentId;
    this.document = createAnalogDocument(this.documentId);
    this.job = new JobController({
      panel: this.panel,
      document: () => this.document,
      acceptDocument: value => {
        this.document = withAnalogCompileResult(value, this.document);
      },
      changed: () => {
        if (!this.isDisposed) {
          this.render();
        }
      },
      bridge: this.bridge,
      client: this.client
    });
    this.id = 'cascaqit-analog-editor';
    this.title.label = 'CASCAQit Analog Editor';
    this.title.closable = true;
    this.addClass('cascaqit-Editor');
    this.addClass('cascaqit-AnalogEditor');
    this.render();
  }

  async bindPanel(panel: NotebookPanel | null): Promise<void> {
    const binding = ++this.panelBinding;
    if (panel === null) {
      this.render();
      return;
    }
    await panel.context.ready;
    if (this.isDisposed || binding !== this.panelBinding) {
      return;
    }
    const restored = this.bridge.restoreAnalog(panel);
    this.document = restored ?? createAnalogDocument(this.documentId);
    this.job.restore(this.document);
    this.message = restored === null
      ? 'Draft Analog program'
      : 'Restored from generated cell metadata';
    this.diagnostics = [];
    this.render();
  }

  get editorDocument(): AnalogEditorDocument {
    return structuredClone(this.document);
  }

  dispose(): void {
    if (!this.isDisposed) {
      this.panelBinding += 1;
      this.job.dispose();
      this.client.disconnect('CASCAQit Analog editor closed.');
    }
    super.dispose();
  }

  private render(): void {
    const fragment = document.createDocumentFragment();
    fragment.append(this.renderHeader());
    const body = element('div', 'cascaqit-Editor-body');
    body.append(
      this.renderRegister(),
      ...CHANNELS.map(channel => this.renderChannel(channel)),
      this.renderMeasurement(),
      this.renderRegisterPreview(),
      this.renderWaveformPreview(),
      this.renderJob(),
      this.renderDiagnostics(),
      this.renderActions()
    );
    fragment.append(body);
    this.node.replaceChildren(fragment);
    if (this.busy || this.job.active) {
      this.node
        .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
          'input, select, button'
        )
        .forEach(control => {
          if (control.dataset.testid !== 'cancel-job') {
            control.disabled = true;
          }
        });
    }
  }

  private renderHeader(): HTMLElement {
    const header = element('header', 'cascaqit-Editor-header');
    const heading = element('div');
    const eyebrow = element('div', 'cascaqit-Editor-eyebrow');
    eyebrow.textContent = 'CASCAQit';
    const title = element('h2', 'cascaqit-Editor-title');
    title.textContent = 'Analog program';
    heading.append(eyebrow, title);
    const status = element(
      'span',
      `cascaqit-Editor-status is-${this.document.compile_status}`
    );
    status.dataset.testid = 'analog-editor-status';
    status.textContent = statusLabel(this.document.compile_status);
    header.append(heading, status);
    return header;
  }

  private renderRegister(): HTMLElement {
    const path = 'editor_model.register.sites';
    const section = editorSection('Atom register', path, this.hasDiagnostic(path));
    const list = element('div', 'cascaqit-AnalogEditor-sites');
    this.document.editor_model.register.sites.forEach((site, index) => {
      const itemPath = `${path}[${index}]`;
      const row = element(
        'div',
        diagnosticClass(
          'cascaqit-AnalogEditor-site',
          this.hasDiagnostic(itemPath, false)
        )
      );
      row.dataset.objectPath = itemPath;
      const identity = textInput(site.id, `Site ${index + 1} ID`, value => {
        this.setDocument(updateSite(this.document, index, { id: value }));
      });
      identity.className = 'cascaqit-AnalogEditor-siteId';
      const x = numberInput(site.x, `Site ${site.id} x in micrometers`, value => {
        this.setDocument(updateSite(this.document, index, { x: value }));
      });
      const y = numberInput(site.y, `Site ${site.id} y in micrometers`, value => {
        this.setDocument(updateSite(this.document, index, { y: value }));
      });
      const occupiedLabel = element('label', 'cascaqit-AnalogEditor-check');
      const occupied = document.createElement('input');
      occupied.type = 'checkbox';
      occupied.checked = site.occupied;
      occupied.setAttribute('aria-label', `Site ${site.id} occupied`);
      occupied.addEventListener('change', () => {
        this.setDocument(
          updateSite(this.document, index, { occupied: occupied.checked })
        );
      });
      occupiedLabel.append(occupied, document.createTextNode('Occupied'));
      const remove = commandButton('Remove', `Remove site ${site.id}`);
      remove.disabled = this.document.editor_model.register.sites.length <= 1;
      remove.addEventListener('click', () => {
        this.setDocument(removeSite(this.document, index));
      });
      const coordinates = element('div', 'cascaqit-AnalogEditor-coordinates');
      coordinates.append(fieldLabel('x', x), fieldLabel('y', y));
      row.append(identity, coordinates, occupiedLabel, remove);
      list.append(row);
    });
    const add = commandButton('Add site', 'Add register site');
    add.addEventListener('click', () => this.setDocument(addSite(this.document)));
    section.append(list, add, this.pathDiagnostics(path));
    return section;
  }

  private renderChannel(channel: AnalogChannel): HTMLElement {
    const path = `editor_model.controls.${channel}`;
    const section = editorSection(
      `${channelLabel(channel)} waveform`,
      path,
      this.hasDiagnostic(path)
    );
    const list = element('div', 'cascaqit-AnalogEditor-segments');
    const segments = this.document.editor_model.controls[channel].segments;
    segments.forEach((segment, index) => {
      const itemPath = `${path}.segments[${index}]`;
      const row = element(
        'div',
        diagnosticClass(
          'cascaqit-AnalogEditor-segment',
          this.hasDiagnostic(itemPath, false)
        )
      );
      row.dataset.objectPath = itemPath;
      const heading = element('div', 'cascaqit-AnalogEditor-segmentHeading');
      const id = textInput(segment.id, `${channel} segment ${index + 1} ID`, value => {
        this.updateChannelSegment(channel, index, { id: value });
      });
      const remove = commandButton('Remove', `Remove ${channel} segment ${index + 1}`);
      remove.disabled = segments.length <= 1;
      remove.addEventListener('click', () => {
        this.setDocument(removeSegment(this.document, channel, index));
      });
      heading.append(id, remove);
      const values = element('div', 'cascaqit-AnalogEditor-segmentValues');
      values.append(
        segmentNumberField('Duration', segment.duration, value => {
          this.updateChannelSegment(channel, index, { duration: value });
        }),
        segmentNumberField('Start', segment.start_value, value => {
          this.updateChannelSegment(channel, index, { start_value: value });
        }),
        segmentNumberField('End', segment.end_value, value => {
          this.updateChannelSegment(channel, index, { end_value: value });
        })
      );
      row.append(heading, values, this.pathDiagnostics(itemPath));
      list.append(row);
    });
    const add = commandButton('Add segment', `Add ${channel} waveform segment`);
    add.addEventListener('click', () => {
      this.setDocument(addSegment(this.document, channel));
    });
    section.append(list, add, this.pathDiagnostics(path));
    return section;
  }

  private renderMeasurement(): HTMLElement {
    const path = 'editor_model.measurement';
    const section = editorSection('Measurement', path, this.hasDiagnostic(path));
    const label = element('label', 'cascaqit-AnalogEditor-check');
    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = this.document.editor_model.measurement.enabled;
    enabled.addEventListener('change', () => {
      this.setDocument(setAnalogMeasurement(this.document, enabled.checked));
    });
    label.append(enabled, document.createTextNode('Terminal ground/Rydberg measurement'));
    section.append(label, this.pathDiagnostics(path));
    return section;
  }

  private renderRegisterPreview(): HTMLElement {
    const section = editorSection('Register preview');
    const viewport = element('div', 'cascaqit-Editor-preview');
    viewport.dataset.testid = 'analog-register-preview';
    const svg = svgNode('svg');
    svg.setAttribute('viewBox', '0 0 420 180');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Analog atom register preview');
    svg.dataset.cascaqitNonempty = 'true';
    const sites = this.document.editor_model.register.sites;
    const xs = sites.map(site => site.x);
    const ys = sites.map(site => site.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    sites.forEach(site => {
      const x = scale(site.x, minX, maxX, 44, 376);
      const y = scale(site.y, minY, maxY, 138, 42);
      const circle = svgNode('circle');
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', site.occupied ? '12' : '10');
      circle.setAttribute(
        'class',
        site.occupied
          ? 'cascaqit-AnalogEditor-siteOccupied'
          : 'cascaqit-AnalogEditor-siteVacant'
      );
      const label = svgText(x, y + 30, site.id, 'cascaqit-Editor-svgLabel');
      label.setAttribute('text-anchor', 'middle');
      svg.append(circle, label);
    });
    viewport.append(svg);
    section.append(viewport);
    return section;
  }

  private renderWaveformPreview(): HTMLElement {
    const section = editorSection('Waveform preview');
    const viewport = element('div', 'cascaqit-Editor-preview');
    viewport.dataset.testid = 'analog-waveform-preview';
    const svg = svgNode('svg');
    svg.setAttribute('viewBox', '0 0 480 270');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Analog global waveform preview');
    svg.dataset.cascaqitNonempty = 'true';
    CHANNELS.forEach((channel, row) => {
      const points = waveformPoints(
        this.document.editor_model.controls[channel].segments
      );
      const values = points.map(point => point.value);
      const duration = Math.max(points.at(-1)?.time ?? 1, Number.EPSILON);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const top = 22 + row * 86;
      const baseline = top + 58;
      svg.append(
        svgLine(64, baseline, 456, baseline, 'cascaqit-AnalogEditor-axis'),
        svgText(8, top + 12, channelLabel(channel), 'cascaqit-Editor-svgLabel')
      );
      const polyline = svgNode('polyline');
      polyline.setAttribute(
        'points',
        points
          .map(point => {
            const x = 64 + (point.time / duration) * 392;
            const y = scale(point.value, min, max, baseline - 8, top + 8);
            return `${x},${y}`;
          })
          .join(' ')
      );
      polyline.setAttribute('class', `cascaqit-AnalogEditor-wave is-${channel}`);
      svg.append(polyline);
    });
    viewport.append(svg);
    section.append(viewport);
    return section;
  }

  private renderDiagnostics(): HTMLElement {
    const region = element('div', 'cascaqit-Editor-message');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.textContent = this.message;
    if (this.diagnostics.length > 0) {
      const list = element('ul', 'cascaqit-Editor-diagnostics');
      for (const diagnostic of this.diagnostics) {
        const item = document.createElement('li');
        item.textContent = diagnosticText(diagnostic);
        list.append(item);
      }
      region.append(list);
    }
    return region;
  }

  private renderActions(): HTMLElement {
    const actions = element('footer', 'cascaqit-Editor-actions');
    const generate = commandButton(
      this.document.generated_cell_id === null ? 'Generate cell' : 'Update cell',
      'Generate or update CASCAQit Analog code cell'
    );
    generate.dataset.testid = 'generate-analog-cell';
    generate.disabled = this.busy || this.job.active;
    generate.addEventListener('click', () => void this.compile());
    actions.append(generate);
    return actions;
  }

  private renderJob(): HTMLElement {
    const runnable =
      this.document.generated_cell_id !== null &&
      !['draft', 'invalid', 'detached'].includes(this.document.compile_status);
    return renderJobView({
      state: this.job.view,
      active: this.job.active,
      canRun: runnable && !this.busy,
      shots: this.shots,
      seed: this.seed,
      analogTimeSteps: this.analogTimeSteps,
      onShots: value => {
        this.shots = value;
      },
      onSeed: value => {
        this.seed = value;
      },
      onAnalogTimeSteps: value => {
        this.analogTimeSteps = value;
      },
      onRun: () => void this.job.start({
        shots: this.shots,
        seed: this.seed,
        analogTimeSteps: this.analogTimeSteps
      }),
      onCancel: () => void this.job.cancel()
    });
  }

  private updateChannelSegment(
    channel: AnalogChannel,
    index: number,
    update: Partial<AnalogSegment>
  ): void {
    this.setDocument(updateSegment(this.document, channel, index, update));
  }

  private setDocument(document: AnalogEditorDocument): void {
    this.document = document;
    this.message = 'Draft Analog program';
    this.diagnostics = [];
    this.render();
  }

  private async compile(): Promise<void> {
    const panel = this.panel();
    if (panel === null) {
      this.message = 'Open a Notebook with a running Python kernel.';
      this.diagnostics = [];
      this.render();
      return;
    }
    await panel.sessionContext.ready;
    const kernel = panel.sessionContext.session?.kernel ?? null;
    if (kernel === null) {
      this.message = 'Open a Notebook with a running Python kernel.';
      this.diagnostics = [];
      this.render();
      return;
    }
    this.busy = true;
    this.message = 'Compiling with the CASCAQit kernel companion';
    this.diagnostics = [];
    this.render();
    try {
      await this.client.connect(kernel);
      let context = this.bridge.context(panel, this.document);
      let response = await this.requestCompile(context.cellId, context.source);
      this.requireSuccess(response);
      let payload = response.payload as unknown as CompilePayload;
      this.document = withAnalogCompileResult(payload.document, this.document);
      if (payload.detached === true) {
        this.message = 'Detached: the generated cell contains user changes.';
        this.diagnostics = diagnosticsFrom(payload.diagnostics);
        return;
      }
      if (context.cellId === null) {
        const cellId = this.bridge.createGeneratedCell(panel);
        response = await this.requestCompile(cellId, null);
        this.requireSuccess(response);
        payload = response.payload as unknown as CompilePayload;
        this.document = withAnalogCompileResult(payload.document, this.document);
        context = { cellId, source: null };
      }
      this.bridge.apply(panel, this.document, payload);
      this.message = 'Ready: generated Analog code cell synchronized.';
      this.diagnostics = diagnosticsFrom(payload.diagnostics);
    } catch (error) {
      const protocol = protocolError(error);
      this.document = { ...this.document, compile_status: 'invalid' };
      this.message = protocol?.message ?? errorMessage(error);
      this.diagnostics = protocolDiagnostics(protocol);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private requestCompile(
    generatedCellId: string | null,
    currentSource: string | null
  ): Promise<CommResponse> {
    return this.client.request(
      this.document.document_id,
      this.document.revision,
      'compile_analog',
      {
        document: this.document,
        generated_cell_id: generatedCellId,
        current_source: currentSource
      }
    );
  }

  private requireSuccess(response: CommResponse): void {
    if (response.status === 'error') {
      throw response.error ?? new Error('CASCAQit Analog compilation failed.');
    }
  }

  private hasDiagnostic(path: string, includeAncestor = true): boolean {
    return this.diagnostics.some(diagnostic => {
      const objectPath = diagnostic.objectPath;
      return (
        objectPath !== null &&
        (
          objectPath.startsWith(path) ||
          (includeAncestor && path.startsWith(objectPath))
        )
      );
    });
  }

  private pathDiagnostics(path: string): HTMLElement {
    const list = element('ul', 'cascaqit-AnalogEditor-inlineDiagnostics');
    for (const diagnostic of this.diagnostics) {
      if (diagnostic.objectPath === null || !diagnostic.objectPath.startsWith(path)) {
        continue;
      }
      const item = document.createElement('li');
      item.textContent = diagnosticText(diagnostic);
      list.append(item);
    }
    list.hidden = list.childElementCount === 0;
    return list;
  }

  private document: AnalogEditorDocument;
  private readonly panel: () => NotebookPanel | null;
  private readonly bridge: NotebookBridge;
  private readonly client: KernelClient;
  private readonly job: JobController;
  private readonly documentId?: () => string;
  private message = 'Draft Analog program';
  private diagnostics: AnalogDiagnostic[] = [];
  private busy = false;
  private shots = 100;
  private seed = 2026;
  private analogTimeSteps = 80;
  private panelBinding = 0;
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

function diagnosticsFrom(value: unknown): AnalogDiagnostic[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(item => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const message = Reflect.get(item, 'message');
    if (typeof message !== 'string') {
      return [];
    }
    const code = Reflect.get(item, 'code');
    const objectPath = Reflect.get(item, 'object_path');
    const suggestion = Reflect.get(item, 'suggestion');
    return [{
      code: typeof code === 'string' ? code : null,
      message,
      objectPath: typeof objectPath === 'string' ? objectPath : null,
      suggestion: typeof suggestion === 'string' ? suggestion : null
    }];
  });
}

function protocolError(value: unknown): ProtocolError | null {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'code') === 'string' &&
    typeof Reflect.get(value, 'message') === 'string'
  )
    ? (value as ProtocolError)
    : null;
}

function protocolDiagnostics(value: ProtocolError | null): AnalogDiagnostic[] {
  if (value === null) {
    return [];
  }
  const diagnostics = diagnosticsFrom(value.details.diagnostics);
  return diagnostics.length > 0
    ? diagnostics
    : [{
        code: value.code,
        message: value.message,
        objectPath: value.object_path,
        suggestion: value.suggestion
      }];
}

function diagnosticText(diagnostic: AnalogDiagnostic): string {
  const code = diagnostic.code === null ? '' : `${diagnostic.code}: `;
  const suggestion = diagnostic.suggestion === null
    ? ''
    : ` ${diagnostic.suggestion}`;
  return `${code}${diagnostic.message}${suggestion}`;
}

function errorMessage(value: unknown): string {
  return value instanceof Error
    ? value.message
    : 'CASCAQit Analog compilation failed.';
}

function editorSection(
  titleText: string,
  path?: string,
  invalid = false
): HTMLElement {
  const section = element(
    'section',
    diagnosticClass('cascaqit-Editor-section', invalid)
  );
  if (path !== undefined) {
    section.dataset.objectPath = path;
  }
  const title = element('h3');
  title.textContent = titleText;
  section.append(title);
  return section;
}

function diagnosticClass(base: string, invalid: boolean): string {
  return invalid ? `${base} has-diagnostic` : base;
}

function textInput(
  value: string,
  label: string,
  update: (value: string) => void
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => update(input.value));
  return input;
}

function numberInput(
  value: number,
  label: string,
  update: (value: number) => void
): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.value = String(value);
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => update(input.valueAsNumber));
  return input;
}

function segmentNumberField(
  label: string,
  value: number,
  update: (value: number) => void
): HTMLLabelElement {
  const field = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = label;
  field.append(text, numberInput(value, label, update));
  return field;
}

function fieldLabel(label: string, input: HTMLInputElement): HTMLLabelElement {
  const field = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = label;
  field.append(text, input);
  return field;
}

function commandButton(text: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  return button;
}

function channelLabel(channel: AnalogChannel): string {
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function scale(
  value: number,
  min: number,
  max: number,
  outputMin: number,
  outputMax: number
): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return (outputMin + outputMax) / 2;
  }
  if (max === min) {
    return (outputMin + outputMax) / 2;
  }
  return outputMin + ((value - min) / (max - min)) * (outputMax - outputMin);
}

function svgLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className: string
): SVGLineElement {
  const line = svgNode('line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.setAttribute('class', className);
  return line;
}

function svgText(
  x: number,
  y: number,
  value: string,
  className: string
): SVGTextElement {
  const text = svgNode('text');
  text.setAttribute('x', String(x));
  text.setAttribute('y', String(y));
  text.setAttribute('class', className);
  text.textContent = value;
  return text;
}

function svgNode<K extends keyof SVGElementTagNameMap>(
  tag: K
): SVGElementTagNameMap[K] {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  return node;
}
