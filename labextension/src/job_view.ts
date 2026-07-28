import { JobViewState, RESULT_MIME } from './job_controller';
import { renderPayload } from './renderer';

export interface JobViewOptions {
  state: JobViewState;
  active: boolean;
  canRun: boolean;
  shots: number;
  seed: number;
  analogTimeSteps?: number;
  onShots: (value: number) => void;
  onSeed: (value: number) => void;
  onAnalogTimeSteps?: (value: number) => void;
  onRun: () => void;
  onCancel: () => void;
}

export function renderJobView(options: JobViewOptions): HTMLElement {
  const section = element('section', 'cascaqit-Editor-section cascaqit-Job');
  const title = element('h3');
  title.textContent = 'Local execution';

  const fields = element('div', 'cascaqit-Job-options');
  fields.append(
    numberField('Shots', options.shots, 1, 1_000_000, options.onShots),
    numberField('Seed', options.seed, 0, Number.MAX_SAFE_INTEGER, options.onSeed)
  );
  if (
    options.analogTimeSteps !== undefined &&
    options.onAnalogTimeSteps !== undefined
  ) {
    fields.append(
      numberField(
        'Time steps',
        options.analogTimeSteps,
        2,
        100_000,
        options.onAnalogTimeSteps
      )
    );
  }

  const status = element('div', 'cascaqit-Job-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.dataset.testid = 'job-status';
  const state = element('strong');
  state.textContent = options.state.state === null
    ? 'Not run'
    : titleCase(options.state.state);
  const message = element('span');
  message.textContent = options.state.message;
  status.append(state, message);
  if (options.state.jobId !== null) {
    const jobId = element('code');
    jobId.textContent = options.state.jobId;
    jobId.title = options.state.jobId;
    status.append(jobId);
  }

  const actions = element('div', 'cascaqit-Job-actions');
  const run = commandButton('Run', 'Run with local CASCAQit backend');
  run.dataset.testid = 'run-job';
  run.disabled = !options.canRun || options.active;
  run.addEventListener('click', options.onRun);
  const cancel = commandButton('Cancel', 'Request local Job cancellation');
  cancel.dataset.testid = 'cancel-job';
  cancel.disabled = !options.active || options.state.cancelRequested;
  cancel.addEventListener('click', options.onCancel);
  actions.append(run, cancel);

  section.append(title, fields, status, actions);
  if (options.state.diagnostics.length > 0) {
    const diagnostics = element('ul', 'cascaqit-Editor-diagnostics');
    for (const value of options.state.diagnostics) {
      const item = document.createElement('li');
      item.textContent = value;
      diagnostics.append(item);
    }
    section.append(diagnostics);
  }
  if (options.state.resultMime !== null) {
    const result = element('div', 'cascaqit-Job-result');
    result.dataset.testid = 'job-result';
    renderPayload(result, RESULT_MIME, options.state.resultMime);
    section.append(result);
  }
  return section;
}

function numberField(
  labelText: string,
  value: number,
  minimum: number,
  maximum: number,
  update: (value: number) => void
): HTMLLabelElement {
  const label = document.createElement('label');
  const text = document.createElement('span');
  text.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = String(minimum);
  input.max = String(maximum);
  input.step = '1';
  input.value = String(value);
  input.setAttribute('aria-label', labelText);
  input.addEventListener('change', () => {
    if (Number.isSafeInteger(input.valueAsNumber)) {
      update(input.valueAsNumber);
    }
  });
  label.append(text, input);
  return label;
}

function commandButton(text: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.setAttribute('aria-label', label);
  return button;
}

function element<K extends keyof HTMLElementTagNameMap>(
  name: K,
  className?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (className !== undefined) {
    node.className = className;
  }
  return node;
}

function titleCase(value: string): string {
  return value
    .replaceAll('_', ' ')
    .replace(/^./, first => first.toUpperCase());
}
