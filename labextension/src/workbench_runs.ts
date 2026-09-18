import type { NotebookPanel } from '@jupyterlab/notebook';
import type { JobEditorDocument, JobViewState } from './job_controller';

export interface WorkbenchRun {
  documentId: string;
  revision: number;
  kind: string;
  source: string | null;
  cellId: string | null;
  time: string;
  stale: boolean;
  view: JobViewState;
}

const history = new WeakMap<NotebookPanel, WorkbenchRun[]>();

export function recordWorkbenchRun(
  panel: NotebookPanel, document: JobEditorDocument, view: JobViewState
): void {
  if (view.jobId === null) {
    return;
  }
  const runs = history.get(panel) ?? [];
  const previous = runs.find(run => run.view.jobId === view.jobId);
  const cell = Array.from(panel.model?.cells ?? [])
    .find(value => value.id === document.generated_cell_id);
  const run: WorkbenchRun = {
    documentId: document.document_id,
    revision: document.revision,
    kind: document.program_kind,
    source: previous?.source ?? cell?.sharedModel.getSource() ?? null,
    cellId: document.generated_cell_id,
    time: previous?.time ?? new Date().toLocaleTimeString(),
    stale: previous?.stale ?? false,
    view: structuredClone(view)
  };
  history.set(panel, [run, ...runs.filter(item => item !== previous)].slice(0, 20));
}

export function markWorkbenchRunsStale(panel: NotebookPanel, documentId: string): void {
  for (const run of history.get(panel) ?? []) {
    if (run.documentId === documentId) { run.stale = true; }
  }
}

export function workbenchRuns(panel: NotebookPanel): WorkbenchRun[] {
  return structuredClone(history.get(panel) ?? []);
}
