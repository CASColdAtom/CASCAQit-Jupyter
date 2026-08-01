import { expect, test } from '@playwright/test';

const SERVER_URL = 'http://127.0.0.1:8899';

test('rejects stale Job responses and recovers after kernel restart', async ({
  page
}, testInfo) => {
  test.skip(
    !testInfo.project.name.endsWith('desktop'),
    'The lifecycle contract is viewport-independent.'
  );

  const notebookFrontend = testInfo.project.name.startsWith('notebook');
  const workspace = `cascaqit-lifecycle-${testInfo.project.name}`;
  const route = notebookFrontend ? 'tree' : `lab/workspaces/${workspace}/tree`;
  const notebookPath = `artifacts/lifecycle-${testInfo.project.name}.ipynb`;
  await page.goto(
    notebookFrontend
      ? `${SERVER_URL}/tree`
      : `${SERVER_URL}/lab/workspaces/${workspace}`
  );
  await putNotebook(page, notebookPath, lifecycleNotebook());
  await page.goto(`${SERVER_URL}/${route}/${notebookPath}`);
  await expect(page.locator('.jp-Notebook:visible')).toBeVisible();
  const newsPrompt = page.getByRole('button', { name: 'No', exact: true });
  if (await newsPrompt.isVisible()) {
    await newsPrompt.click();
  }

  await expect(page.getByRole('progressbar', { name: 'Kernel status' })).toHaveAttribute(
    'aria-valuenow',
    '100'
  );
  const setupCell = page.locator('.jp-CodeCell').first();
  await setupCell.locator('.cm-content').click();
  await page
    .locator('.jp-NotebookPanel-toolbar')
    .getByRole('button', { name: /Run .* advance/ })
    .click();
  await expect(setupCell.locator('.jp-OutputArea-output')).toContainText(
    'lifecycle hooks ready'
  );

  await openEditor(page);
  const editor = page.locator('.cascaqit-Editor');
  await editor.getByTestId('generate-cell').click();
  await expect(editor.getByTestId('editor-status')).toHaveText('Ready');

  const run = editor.getByTestId('run-job');
  const cancel = editor.getByTestId('cancel-job');
  const status = editor.getByTestId('job-status');

  await run.click();
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(status).toContainText('Cancelled');
  await expect(status).toContainText('Local Job cancelled.');
  await expect(editor.getByTestId('job-result')).toHaveCount(0);

  await run.click();
  await expect(status).toContainText('CASCAQit request timed out: job_status', {
    timeout: 20_000
  });
  await expect(editor.getByTestId('job-result')).toHaveCount(0);

  // The delayed completed response arrives after the client timeout and must stay ignored.
  await page.waitForTimeout(3_000);
  await expect(status).toContainText('CASCAQit request timed out: job_status');
  await expect(editor.getByTestId('job-result')).toHaveCount(0);

  const measurementKey = editor.getByLabel('Measurement key');
  await measurementKey.fill('after_timeout');
  await measurementKey.press('Tab');
  await expect(editor.getByTestId('editor-status')).toHaveText('Draft');
  await expect(status).toContainText('Not run');
  await expect(run).toHaveText('Update & Run');
  await run.click();
  await expect(status).toContainText('Completed', { timeout: 20_000 });
  const recoveredJobId = await status.locator('code').textContent();
  await expect(editor.getByTestId('job-result')).toBeVisible();

  await restartKernel(page, notebookPath);
  await measurementKey.fill('after_restart');
  await measurementKey.press('Tab');
  await expect(editor.getByTestId('editor-status')).toHaveText('Draft');
  await expect(status).toContainText('Not run');
  await expect(editor.getByTestId('job-result')).toHaveCount(0);
  await run.click();
  await expect(status).toContainText('Completed', { timeout: 20_000 });
  const restartedJobId = await status.locator('code').textContent();
  expect(restartedJobId).not.toBe(recoveredJobId);
  await expect(editor.getByTestId('job-result')).toBeVisible();
});

async function openEditor(page: any): Promise<void> {
  await expect(async () => {
    await page.locator('.jp-Notebook:visible').focus();
    await page.keyboard.press('Alt+Shift+Q');
    await expect(page.locator('.cascaqit-Editor')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000, intervals: [500] });
}

async function restartKernel(page: any, notebookPath: string): Promise<void> {
  await page.evaluate(async path => {
    const sessionsResponse = await fetch('/api/sessions');
    if (!sessionsResponse.ok) {
      throw new Error(`Session lookup failed: ${sessionsResponse.status}`);
    }
    const sessions = await sessionsResponse.json();
    const session = sessions.find((item: any) => item.path === path);
    if (session === undefined) {
      throw new Error(`No running session found for ${path}.`);
    }
    const xsrf = document.cookie
      .split('; ')
      .find(item => item.startsWith('_xsrf='))
      ?.split('=')[1];
    const restartResponse = await fetch(`/api/kernels/${session.kernel.id}/restart`, {
      method: 'POST',
      headers: xsrf === undefined
        ? {}
        : { 'X-XSRFToken': decodeURIComponent(xsrf) }
    });
    if (!restartResponse.ok) {
      throw new Error(`Kernel restart failed: ${restartResponse.status}`);
    }
  }, notebookPath);
  await page.waitForTimeout(1_000);
}

async function putNotebook(
  page: any,
  path: string,
  content: Record<string, unknown>
): Promise<void> {
  await page.evaluate(
    async ({ target, notebook }) => {
      const xsrf = document.cookie
        .split('; ')
        .find(item => item.startsWith('_xsrf='))
        ?.split('=')[1];
      const response = await fetch(`/api/contents/${target}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...(xsrf === undefined ? {} : { 'X-XSRFToken': decodeURIComponent(xsrf) })
        },
        body: JSON.stringify({ type: 'notebook', format: 'json', content: notebook })
      });
      if (!response.ok) {
        throw new Error(`Notebook fixture write failed: ${response.status}`);
      }
    },
    { target: path, notebook: content }
  );
}

function lifecycleNotebook(): Record<string, unknown> {
  return {
    cells: [{
      cell_type: 'code',
      execution_count: null,
      id: 'lifecycle-setup',
      metadata: {},
      outputs: [],
      source: [
        'import time\n',
        'from cascaqit_jupyter.comm import KernelSession\n',
        'from cascaqit_jupyter.jobs import KernelJobManager\n',
        '\n',
        '_cascaqit_original_handle = KernelSession.handle\n',
        '_cascaqit_original_execute = KernelJobManager._execute\n',
        '_cascaqit_delay_status_once = True\n',
        '\n',
        'def _cascaqit_delayed_handle(self, raw):\n',
        '    global _cascaqit_delay_status_once\n',
        '    if (\n',
        '        _cascaqit_delay_status_once\n',
        '        and isinstance(raw, dict)\n',
        '        and raw.get("operation") == "job_status"\n',
        '    ):\n',
        '        _cascaqit_delay_status_once = False\n',
        '        time.sleep(12)\n',
        '    return _cascaqit_original_handle(self, raw)\n',
        '\n',
        'def _cascaqit_delayed_execute(self, job_id):\n',
        '    time.sleep(5)\n',
        '    return _cascaqit_original_execute(self, job_id)\n',
        '\n',
        'KernelSession.handle = _cascaqit_delayed_handle\n',
        'KernelJobManager._execute = _cascaqit_delayed_execute\n',
        'print("lifecycle hooks ready")\n'
      ]
    }],
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3'
      },
      language_info: { name: 'python', version: '3.9.6' }
    },
    nbformat: 4,
    nbformat_minor: 5
  };
}
