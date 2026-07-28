import { IRenderMime } from '@jupyterlab/rendermime-interfaces';
import { Widget } from '@lumino/widgets';

import '../labextension/style/index.css';

const MIME_TYPES = [
  'application/vnd.cascaqit.program+json',
  'application/vnd.cascaqit.result+json',
  'application/vnd.cascaqit.diagnostics+json',
  'application/vnd.cascaqit.visualization+json'
];

type JsonRecord = { [key: string]: unknown };

class CASCAQitRenderer extends Widget implements IRenderMime.IRenderer {
  constructor(options: IRenderMime.IRendererOptions) {
    super();
    this.mimeType = options.mimeType;
    this.addClass('cascaqit-Renderer');
  }

  async renderModel(model: IRenderMime.IMimeModel): Promise<void> {
    const payload = model.data[this.mimeType];
    this.node.replaceChildren();

    if (!isRecord(payload) || !isRecord(payload.source) || !isRecord(payload.data)) {
      this.renderError('Invalid CASCAQit MIME payload');
      return;
    }

    const kind = stringValue(payload.kind, 'artifact');
    const sourceId = stringValue(payload.source.id, 'unknown source');
    const sourceHash = stringValue(payload.source.hash, 'unavailable');

    const heading = document.createElement('div');
    heading.className = 'cascaqit-Renderer-heading';
    heading.textContent = `CASCAQit ${titleCase(kind)}`;

    const identity = document.createElement('div');
    identity.className = 'cascaqit-Renderer-identity';
    identity.textContent = `${sourceId} | ${sourceHash.slice(0, 12)}`;

    const summary = document.createElement('dl');
    summary.className = 'cascaqit-Renderer-summary';
    for (const [label, value] of summaryRows(kind, payload.data)) {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      summary.append(term, detail);
    }

    this.node.append(heading, identity, summary);
  }

  private renderError(message: string): void {
    const error = document.createElement('div');
    error.className = 'cascaqit-Renderer-error';
    error.textContent = message;
    this.node.append(error);
  }

  private readonly mimeType: string;
}

function summaryRows(kind: string, data: JsonRecord): Array<[string, string]> {
  if (kind === 'program') {
    return [
      ['Program type', stringValue(data.program_type, 'unknown')],
      ['Lifecycle', stringValue(data.lifecycle_state, 'unspecified')],
      ['Schema', stringValue(data.schema_version, 'unknown')]
    ];
  }
  if (kind === 'result') {
    const counts = isRecord(data.counts) ? Object.keys(data.counts).length : 0;
    return [
      ['Shots', numberValue(data.shots)],
      ['Observed states', String(counts)],
      ['Target', stringValue(data.target_id, 'unknown')]
    ];
  }
  if (kind === 'diagnostics') {
    const items = Array.isArray(data.items) ? data.items : [];
    return [['Diagnostics', String(items.length)]];
  }
  const spec = isRecord(data.spec) ? data.spec : {};
  return [
    ['Visualization', stringValue(spec.visualization_kind, 'unknown')],
    ['Title', stringValue(spec.title, 'Untitled')],
    ['Schema', stringValue(data.schema_version, 'unknown')]
  ];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : 'unknown';
}

function titleCase(value: string): string {
  return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
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
