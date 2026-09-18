import { describe, expect, it } from 'vitest';
import type { NotebookPanel } from '@jupyterlab/notebook';
import type { JobEditorDocument, JobViewState } from '../src/job_controller';
import { markWorkbenchRunsStale, recordWorkbenchRun, workbenchRuns } from '../src/workbench_runs';

function panel(): NotebookPanel {
  return { model: { cells: [{ id: 'cell', sharedModel: { getSource: () => 'original' } }] } } as unknown as NotebookPanel;
}
const document: JobEditorDocument = {
  document_id: 'doc', revision: 1, program_kind: 'digital', generated_cell_id: 'cell',
  compile_status: 'completed', metadata: {}
};
function view(id: string): JobViewState {
  return { state: 'completed', jobId: id, cancelRequested: false, message: '',
    resultMime: { counts: { '00': 16 } }, diagnostics: [] };
}

describe('workbench run snapshots', () => {
  it('keeps notebook histories isolated and bounds retained results', () => {
    const a = panel(), b = panel();
    for (let i = 0; i < 25; i++) { recordWorkbenchRun(a, document, view(String(i))); }
    expect(workbenchRuns(a)).toHaveLength(20);
    expect(workbenchRuns(a)[0].view.jobId).toBe('24');
    expect(workbenchRuns(b)).toEqual([]);
  });
  it('updates one job without rewriting execution source or exposing mutable state', () => {
    const a = panel();
    recordWorkbenchRun(a, document, { ...view('job'), state: 'running', resultMime: null });
    recordWorkbenchRun(a, document, view('job'));
    expect(workbenchRuns(a)).toHaveLength(1);
    expect(workbenchRuns(a)[0].source).toBe('original');
    const snapshot = workbenchRuns(a);
    snapshot[0].view.state = 'failed';
    expect(workbenchRuns(a)[0].view.state).toBe('completed');
  });
  it('marks historical output stale on draft edits and starts a fresh run cleanly', () => {
    const a = panel();
    recordWorkbenchRun(a, document, view('old'));
    markWorkbenchRunsStale(a, 'doc');
    recordWorkbenchRun(a, { ...document, revision: 2 }, view('new'));
    expect(workbenchRuns(a).map(run => run.stale)).toEqual([false, true]);
  });
});
