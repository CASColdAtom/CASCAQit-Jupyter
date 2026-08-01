import type { NotebookPanel } from '@jupyterlab/notebook';
import { Widget } from '@lumino/widgets';

import {
  DigitalEditorDocument,
  addGate,
  addQubit,
  createDigitalDocument,
  moveGate,
  removeGate,
  removeQubit,
  renameQubit,
  restoreDigitalDocument,
  setMeasurement,
  withCompileResult
} from './digital_document';
import { KernelClient } from './kernel_client';
import { JobController } from './job_controller';
import { renderJobView } from './job_view';
import { CompilePayload, NotebookBridge } from './notebook_bridge';
import type { CommResponse, ProtocolError } from './protocol';

const GATE_OPTIONS = [
  'h', 'x', 'y', 'z', 'rx', 'ry', 'rz', 'cx', 'cy', 'cz', 'swap', 'ccx'
];
const ROTATION_GATES = new Set(['rx', 'ry', 'rz']);
const CONTROLLED_TWO_QUBIT_GATES = new Set(['cx', 'cy', 'cz']);

export interface DigitalEditorOptions {
  panel: () => NotebookPanel | null;
  bridge?: NotebookBridge;
  client?: KernelClient;
  documentId?: () => string;
}

export class DigitalEditorWidget extends Widget {
  constructor(options: DigitalEditorOptions) {
    super();
    this.panel = options.panel;
    this.bridge = options.bridge ?? new NotebookBridge();
    this.client = options.client ?? new KernelClient();
    this.documentId = options.documentId;
    this.document = createDigitalDocument(this.documentId);
    this.job = new JobController({
      panel: this.panel,
      document: () => this.document,
      acceptDocument: value => {
        this.document = withCompileResult(value, this.document);
      },
      changed: () => {
        if (!this.isDisposed) {
          this.render();
        }
      },
      bridge: this.bridge,
      client: this.client
    });
    this.id = 'cascaqit-digital-editor';
    this.title.label = 'CASCAQit Digital Editor';
    this.title.closable = true;
    this.addClass('cascaqit-Editor');
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
    const restored = this.bridge.restore(panel);
    this.document = restored ?? createDigitalDocument(this.documentId);
    this.job.restore(this.document);
    this.message = restored === null
      ? 'Draft circuit'
      : 'Restored from generated cell metadata';
    this.render();
  }

  get editorDocument(): DigitalEditorDocument {
    return structuredClone(this.document);
  }

  dispose(): void {
    if (!this.isDisposed) {
      this.panelBinding += 1;
      this.job.dispose();
      this.client.disconnect('CASCAQit Digital editor closed.');
    }
    super.dispose();
  }

  private render(): void {
    const fragment = document.createDocumentFragment();
    fragment.append(this.renderHeader(), this.renderDiagnostics());

    const body = element('div', 'cascaqit-Editor-body is-digital');
    const authoring = element(
      'div',
      'cascaqit-Editor-column cascaqit-Editor-column--authoring'
    );
    authoring.append(
      this.renderQubits(),
      this.renderGateComposer(),
      this.renderGateSequence(),
      this.renderMeasurement()
    );
    const inspection = element(
      'div',
      'cascaqit-Editor-column cascaqit-Editor-column--inspection'
    );
    inspection.append(
      this.renderPreview(),
      this.renderJob()
    );
    body.append(
      authoring,
      inspection,
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
    title.textContent = 'Digital circuit';
    heading.append(eyebrow, title);

    const status = element('span', `cascaqit-Editor-status is-${this.document.compile_status}`);
    status.dataset.testid = 'editor-status';
    status.textContent = statusLabel(this.document.compile_status);
    header.append(heading, status);
    return header;
  }

  private renderQubits(): HTMLElement {
    const section = editorSection('Qubits');
    const list = element('div', 'cascaqit-Editor-list');
    this.document.editor_model.qubits.forEach((qubit, index) => {
      const row = element('div', 'cascaqit-Editor-row');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = qubit.id;
      input.setAttribute('aria-label', `Qubit ${index + 1} ID`);
      input.addEventListener('change', () => {
        this.setDocument(renameQubit(this.document, index, input.value));
      });
      const remove = commandButton('Remove', `Remove qubit ${qubit.id}`);
      remove.disabled = this.document.editor_model.qubits.length <= 1;
      remove.addEventListener('click', () => {
        this.setDocument(removeQubit(this.document, index));
      });
      row.append(input, remove);
      list.append(row);
    });
    const add = commandButton('Add qubit', 'Add qubit');
    add.addEventListener('click', () => this.setDocument(addQubit(this.document)));
    section.append(list, add);
    return section;
  }

  private renderGateComposer(): HTMLElement {
    const section = editorSection('Add gate');
    const form = element('div', 'cascaqit-Editor-gateForm');
    const gate = document.createElement('select');
    gate.setAttribute('aria-label', 'Gate');
    for (const name of GATE_OPTIONS) {
      gate.append(new Option(name.toUpperCase(), name));
    }
    const targetA = targetSelect(
      this.document.editor_model.qubits,
      'Gate target'
    );
    const targetB = targetSelect(
      this.document.editor_model.qubits,
      'Second gate target',
      true
    );
    const targetC = targetSelect(
      this.document.editor_model.qubits,
      'Third gate target',
      true
    );
    const theta = document.createElement('input');
    theta.type = 'number';
    theta.step = 'any';
    theta.placeholder = 'theta';
    theta.setAttribute('aria-label', 'Rotation angle theta');
    theta.hidden = true;
    const configureTargets = (): void => {
      theta.hidden = !ROTATION_GATES.has(gate.value);
      targetB.hidden = !(
        CONTROLLED_TWO_QUBIT_GATES.has(gate.value) ||
        gate.value === 'swap' ||
        gate.value === 'ccx'
      );
      targetC.hidden = gate.value !== 'ccx';
      if (CONTROLLED_TWO_QUBIT_GATES.has(gate.value)) {
        targetA.setAttribute('aria-label', 'Control qubit');
        targetB.setAttribute('aria-label', 'Target qubit');
      } else if (gate.value === 'ccx') {
        targetA.setAttribute('aria-label', 'First control qubit');
        targetB.setAttribute('aria-label', 'Second control qubit');
        targetC.setAttribute('aria-label', 'Target qubit');
      } else if (gate.value === 'swap') {
        targetA.setAttribute('aria-label', 'First swap qubit');
        targetB.setAttribute('aria-label', 'Second swap qubit');
      } else {
        targetA.setAttribute('aria-label', 'Gate target');
      }
      const available = this.document.editor_model.qubits.map(qubit => qubit.id);
      if (!targetB.hidden && targetB.value === '') {
        targetB.value = available.find(value => value !== targetA.value) ?? '';
      }
      if (!targetC.hidden && targetC.value === '') {
        targetC.value = available.find(
          value => value !== targetA.value && value !== targetB.value
        ) ?? '';
      }
    };
    gate.addEventListener('change', configureTargets);
    configureTargets();
    const add = commandButton('Add', 'Add gate');
    add.addEventListener('click', () => {
      const targets = [targetA, targetB, targetC]
        .filter(target => !target.hidden)
        .map(target => target.value)
        .filter(Boolean);
      const parameters: Record<string, number> = {};
      if (ROTATION_GATES.has(gate.value) && theta.value !== '') {
        parameters.theta = Number(theta.value);
      }
      this.setDocument(addGate(this.document, { gate: gate.value, targets, parameters }));
    });
    form.append(gate, targetA, targetB, targetC, theta, add);
    section.append(form);
    return section;
  }

  private renderGateSequence(): HTMLElement {
    const section = editorSection('Gate sequence');
    const list = element('ol', 'cascaqit-Editor-gates');
    if (this.document.editor_model.gates.length === 0) {
      const empty = element('p', 'cascaqit-Editor-empty');
      empty.textContent = 'No gates';
      section.append(empty);
      return section;
    }
    this.document.editor_model.gates.forEach((gate, index) => {
      const row = element('li', 'cascaqit-Editor-gate');
      row.dataset.gateId = gate.id;
      const summary = element('div', 'cascaqit-Editor-gateSummary');
      const name = element('strong');
      name.textContent = gate.gate.toUpperCase();
      const targets = element('span');
      targets.textContent = gateRoleSummary(gate.gate, gate.targets);
      const parameters = Object.entries(gate.parameters);
      if (parameters.length > 0) {
        targets.textContent += ` | ${parameters.map(([key, value]) => `${key}=${value}`).join(', ')}`;
      }
      summary.append(name, targets);
      const commands = element('div', 'cascaqit-Editor-gateCommands');
      const up = commandButton('Up', `Move ${gate.gate} gate up`);
      up.disabled = index === 0;
      up.addEventListener('click', () => this.setDocument(moveGate(this.document, index, -1)));
      const down = commandButton('Down', `Move ${gate.gate} gate down`);
      down.disabled = index === this.document.editor_model.gates.length - 1;
      down.addEventListener('click', () => this.setDocument(moveGate(this.document, index, 1)));
      const remove = commandButton('Remove', `Remove ${gate.gate} gate`);
      remove.addEventListener('click', () => this.setDocument(removeGate(this.document, index)));
      commands.append(up, down, remove);
      row.append(summary, commands);
      list.append(row);
    });
    section.append(list);
    return section;
  }

  private renderMeasurement(): HTMLElement {
    const section = editorSection('Measurement');
    const fields = element('div', 'cascaqit-Editor-fields');
    const terminalLabel = document.createElement('label');
    const terminal = document.createElement('input');
    terminal.type = 'checkbox';
    terminal.checked = this.document.editor_model.measurement.terminal;
    terminal.addEventListener('change', () => {
      this.setDocument(
        setMeasurement(
          this.document,
          terminal.checked,
          this.document.editor_model.measurement.key
        )
      );
    });
    terminalLabel.append(terminal, document.createTextNode(' Terminal measurement'));
    const key = document.createElement('input');
    key.type = 'text';
    key.value = this.document.editor_model.measurement.key;
    key.setAttribute('aria-label', 'Measurement key');
    key.addEventListener('change', () => {
      this.setDocument(
        setMeasurement(
          this.document,
          this.document.editor_model.measurement.terminal,
          key.value
        )
      );
    });
    fields.append(terminalLabel, key);
    section.append(fields);
    return section;
  }

  private renderPreview(): HTMLElement {
    const section = editorSection('Circuit preview');
    const viewport = element('div', 'cascaqit-Editor-preview');
    viewport.dataset.testid = 'editor-circuit-preview';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const qubits = this.document.editor_model.qubits;
    const gates = this.document.editor_model.gates;
    const width = Math.max(420, 140 + gates.length * 82);
    const height = Math.max(96, 52 + qubits.length * 48);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${qubits.length} qubit Digital circuit preview`);
    svg.dataset.cascaqitNonempty = 'true';
    qubits.forEach((qubit, row) => {
      const y = 42 + row * 48;
      svg.append(
        svgText(12, y + 4, qubit.id, 'cascaqit-Editor-svgLabel'),
        svgLine(64, y, width - 20, y, 'cascaqit-Editor-svgWire')
      );
    });
    gates.forEach((gate, column) => {
      const x = 96 + column * 82;
      const targetRows = gate.targets
        .map(target => qubits.findIndex(qubit => qubit.id === target))
        .filter(row => row >= 0);
      if (targetRows.length > 1) {
        svg.append(
          svgLine(
            x,
            42 + Math.min(...targetRows) * 48,
            x,
            42 + Math.max(...targetRows) * 48,
            'cascaqit-Editor-svgConnector'
          )
        );
      }
      const controlled = controlledGate(gate.gate, targetRows);
      if (controlled !== null) {
        controlled.controls.forEach(row => {
          const control = svgCircle(
            x,
            42 + row * 48,
            6,
            'cascaqit-Editor-svgControl'
          );
          control.dataset.role = 'control';
          svg.append(control);
        });
        appendControlledTarget(svg, x, 42 + controlled.target * 48, gate.gate);
      } else if (gate.gate === 'swap' && targetRows.length >= 2) {
        targetRows.slice(0, 2).forEach(row => {
          appendSwap(svg, x, 42 + row * 48);
        });
      } else {
        targetRows.forEach(row => {
          appendGateBox(svg, x, 42 + row * 48, gate.gate.toUpperCase());
        });
      }
    });
    viewport.append(svg);
    section.append(viewport);
    return section;
  }

  private renderDiagnostics(): HTMLElement {
    const invalid = this.document.compile_status === 'invalid';
    const region = element(
      'div',
      invalid ? 'cascaqit-Editor-message is-invalid' : 'cascaqit-Editor-message'
    );
    region.dataset.testid = 'editor-diagnostics';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.textContent = this.message;
    if (this.diagnostics.length > 0) {
      const list = element('ul', 'cascaqit-Editor-diagnostics');
      for (const diagnostic of this.diagnostics) {
        const item = document.createElement('li');
        item.textContent = diagnostic;
        list.append(item);
      }
      region.append(list);
    }
    return region;
  }

  private renderJob(): HTMLElement {
    const updateBeforeRun = this.document.compile_status === 'draft';
    const runnable = this.document.generated_cell_id !== null &&
      !['invalid', 'detached'].includes(this.document.compile_status);
    return renderJobView({
      state: this.job.view,
      active: this.job.active,
      canRun: runnable && !this.busy,
      runLabel: updateBeforeRun ? 'Update & Run' : 'Run',
      shots: this.shots,
      seed: this.seed,
      onShots: value => {
        this.shots = value;
      },
      onSeed: value => {
        this.seed = value;
      },
      onRun: () => void this.runJob(),
      onCancel: () => void this.job.cancel()
    });
  }

  private renderActions(): HTMLElement {
    const actions = element('footer', 'cascaqit-Editor-actions');
    const generate = commandButton(
      this.document.generated_cell_id === null ? 'Generate cell' : 'Update cell',
      'Generate or update CASCAQit code cell'
    );
    generate.dataset.testid = 'generate-cell';
    generate.disabled = this.busy || this.job.active;
    generate.addEventListener('click', () => void this.compile());
    actions.append(generate);
    return actions;
  }

  private setDocument(document: DigitalEditorDocument): void {
    this.document = document;
    this.message = 'Draft circuit';
    this.diagnostics = [];
    this.job.markDocumentChanged();
  }

  private async runJob(): Promise<void> {
    if (this.document.compile_status === 'draft' && !(await this.compile())) {
      return;
    }
    await this.job.start({ shots: this.shots, seed: this.seed });
  }

  private async compile(): Promise<boolean> {
    const panel = this.panel();
    if (panel === null) {
      this.message = 'Open a Notebook with a running Python kernel.';
      this.diagnostics = [];
      this.render();
      return false;
    }
    await panel.sessionContext.ready;
    const kernel = panel.sessionContext.session?.kernel ?? null;
    if (kernel === null) {
      this.message = 'Open a Notebook with a running Python kernel.';
      this.diagnostics = [];
      this.render();
      return false;
    }

    this.busy = true;
    this.message = 'Compiling with the CASCAQit kernel companion';
    this.diagnostics = [];
    this.render();
    try {
      await this.client.connect(kernel);
      let context = this.bridge.context(panel, this.document);
      let response = await this.requestCompile(context.cellId, context.source);
      let payload = response.payload as unknown as CompilePayload;
      this.requireSuccess(response);
      this.document = withCompileResult(payload.document, this.document);

      if (payload.detached === true) {
        this.message = 'Detached: the generated cell contains user changes.';
        this.diagnostics = diagnosticMessages(payload.diagnostics);
        return false;
      }

      if (context.cellId === null) {
        const cellId = this.bridge.createGeneratedCell(panel);
        response = await this.requestCompile(cellId, null);
        this.requireSuccess(response);
        payload = response.payload as unknown as CompilePayload;
        this.document = withCompileResult(payload.document, this.document);
        context = { cellId, source: null };
      }

      this.bridge.apply(panel, this.document, payload);
      this.message = 'Ready: generated code cell synchronized.';
      this.diagnostics = diagnosticMessages(payload.diagnostics);
      return true;
    } catch (error) {
      const protocol = protocolError(error);
      this.document = {
        ...this.document,
        compile_status: 'invalid'
      };
      this.message = 'Invalid circuit. Fix the issue below, then update or run again.';
      this.diagnostics = protocolDiagnostics(protocol);
      if (this.diagnostics.length === 0) {
        this.diagnostics = [protocol?.message ?? errorMessage(error)];
      }
      return false;
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
      'compile_digital',
      {
        document: this.document,
        generated_cell_id: generatedCellId,
        current_source: currentSource
      }
    );
  }

  private requireSuccess(response: CommResponse): void {
    if (response.status === 'error') {
      throw response.error ?? new Error('CASCAQit compilation failed.');
    }
  }

  private document: DigitalEditorDocument;
  private readonly panel: () => NotebookPanel | null;
  private readonly bridge: NotebookBridge;
  private readonly client: KernelClient;
  private readonly job: JobController;
  private readonly documentId?: () => string;
  private message = 'Draft circuit';
  private diagnostics: string[] = [];
  private busy = false;
  private shots = 100;
  private seed = 2026;
  private panelBinding = 0;
}

function targetSelect(
  qubits: Array<{ id: string }>,
  label: string,
  optional = false
): HTMLSelectElement {
  const select = document.createElement('select');
  select.setAttribute('aria-label', label);
  if (optional) {
    select.append(new Option('Select qubit', ''));
  }
  qubits.forEach(qubit => select.append(new Option(qubit.id, qubit.id)));
  return select;
}

function gateRoleSummary(gate: string, targets: string[]): string {
  if (CONTROLLED_TWO_QUBIT_GATES.has(gate) && targets.length >= 2) {
    return `Control ${targets[0]} -> target ${targets[1]}`;
  }
  if (gate === 'ccx' && targets.length >= 3) {
    return `Controls ${targets[0]}, ${targets[1]} -> target ${targets[2]}`;
  }
  if (gate === 'swap' && targets.length >= 2) {
    return `Swap ${targets[0]} <-> ${targets[1]}`;
  }
  return targets.join(', ') || 'No target';
}

function controlledGate(
  gate: string,
  rows: number[]
): { controls: number[]; target: number } | null {
  if (CONTROLLED_TWO_QUBIT_GATES.has(gate) && rows.length >= 2) {
    return { controls: [rows[0]], target: rows[1] };
  }
  if (gate === 'ccx' && rows.length >= 3) {
    return { controls: rows.slice(0, 2), target: rows[2] };
  }
  return null;
}

function appendControlledTarget(
  svg: SVGSVGElement,
  x: number,
  y: number,
  gate: string
): void {
  const targetName = gate === 'ccx' ? 'x' : gate.slice(1);
  if (targetName === 'x') {
    const target = svgCircle(x, y, 15, 'cascaqit-Editor-svgTarget');
    target.dataset.role = 'target';
    svg.append(
      target,
      svgLine(x - 8, y, x + 8, y, 'cascaqit-Editor-svgTargetLine'),
      svgLine(x, y - 8, x, y + 8, 'cascaqit-Editor-svgTargetLine')
    );
    return;
  }
  appendGateBox(svg, x, y, targetName.toUpperCase(), 'target');
}

function appendGateBox(
  svg: SVGSVGElement,
  x: number,
  y: number,
  label: string,
  role?: string
): void {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  rect.setAttribute('x', String(x - 22));
  rect.setAttribute('y', String(y - 16));
  rect.setAttribute('width', '44');
  rect.setAttribute('height', '32');
  rect.setAttribute('rx', '3');
  rect.setAttribute('class', 'cascaqit-Editor-svgGate');
  if (role !== undefined) {
    rect.dataset.role = role;
  }
  svg.append(rect, svgText(x, y + 4, label, 'cascaqit-Editor-svgGateText'));
}

function appendSwap(svg: SVGSVGElement, x: number, y: number): void {
  const first = svgLine(x - 8, y - 8, x + 8, y + 8, 'cascaqit-Editor-svgSwap');
  const second = svgLine(x - 8, y + 8, x + 8, y - 8, 'cascaqit-Editor-svgSwap');
  first.dataset.role = 'swap';
  second.dataset.role = 'swap';
  svg.append(first, second);
}

function editorSection(titleText: string): HTMLElement {
  const section = element('section', 'cascaqit-Editor-section');
  const title = element('h3');
  title.textContent = titleText;
  section.append(title);
  return section;
}

function commandButton(text: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  return button;
}

function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function diagnosticMessages(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(item => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const code = Reflect.get(item, 'code');
    const message = Reflect.get(item, 'message');
    const objectPath = Reflect.get(item, 'object_path');
    const suggestion = Reflect.get(item, 'suggestion');
    return typeof message === 'string'
      ? [
          `${typeof code === 'string' ? `${code}: ` : ''}${message}` +
          `${typeof objectPath === 'string' ? ` Field: ${objectPath}.` : ''}` +
          `${typeof suggestion === 'string' ? ` Suggestion: ${suggestion}` : ''}`
        ]
      : [];
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

function protocolDiagnostics(value: ProtocolError | null): string[] {
  if (value === null) {
    return [];
  }
  const diagnostics = value.details.diagnostics;
  const messages = diagnosticMessages(diagnostics);
  return messages.length > 0
    ? messages
    : [
        `${value.code}: ${value.message}` +
        `${value.object_path === null ? '' : ` Field: ${value.object_path}.`}` +
        `${value.suggestion === null ? '' : ` Suggestion: ${value.suggestion}`}`
      ];
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : 'CASCAQit compilation failed.';
}

function svgLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  className: string
): SVGLineElement {
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', String(x1));
  line.setAttribute('y1', String(y1));
  line.setAttribute('x2', String(x2));
  line.setAttribute('y2', String(y2));
  line.setAttribute('class', className);
  return line;
}

function svgCircle(
  cx: number,
  cy: number,
  radius: number,
  className: string
): SVGCircleElement {
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
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
  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', String(x));
  text.setAttribute('y', String(y));
  text.setAttribute('class', className);
  text.textContent = value;
  return text;
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
