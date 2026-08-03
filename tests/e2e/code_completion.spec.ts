import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const SERVER_URL = 'http://127.0.0.1:8899';

test('offers automatic completion in notebook Code Cells', async ({ page }, testInfo) => {
  const notebookFrontend = testInfo.project.name.startsWith('notebook');
  const workspace = `cascaqit-completion-${testInfo.project.name}`;
  const route = notebookFrontend ? 'tree' : `lab/workspaces/${workspace}/tree`;
  const notebookPath = `artifacts/completion-${testInfo.project.name}.ipynb`;
  await page.goto(
    notebookFrontend
      ? `${SERVER_URL}/tree`
      : `${SERVER_URL}/lab/workspaces/${workspace}`
  );
  await putNotebook(page, notebookPath, blankNotebook());
  await page.goto(`${SERVER_URL}/${route}/${notebookPath}`);
  await expect(page.locator('.jp-Notebook:visible')).toBeVisible();
  const newsPrompt = page.getByRole('button', { name: 'No', exact: true });
  if (await newsPrompt.isVisible()) {
    await newsPrompt.click();
  }
  const toggle = page.getByTestId('toggle-code-autocompletion');
  let openedToolbarPopup = false;
  if (!(await toggle.isVisible())) {
    await page
      .locator('.jp-NotebookPanel-toolbar')
      .getByRole('button', { name: 'More commands' })
      .click();
    openedToolbarPopup = true;
  }
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAttribute(
    'aria-label',
    'Disable automatic Code Cell completion'
  );
  if (openedToolbarPopup) {
    await page
      .locator('.jp-NotebookPanel-toolbar')
      .getByRole('button', { name: 'More commands' })
      .click();
  }

  const setupCell = page.locator('.jp-CodeCell').first();
  await setupCell.locator('.cm-content').click();
  await setupCell.locator('.cm-content').press('Shift+Enter');
  await expect(setupCell.locator('.jp-InputPrompt')).toContainText('[1]');

  const source = page.locator('.jp-CodeCell .cm-content').last();
  await source.click();
  await source.pressSequentially('cascaqit.Cir', { delay: 80 });

  const completer = page.locator('.jp-Completer:visible');
  const circuit = completer.locator('.jp-Completer-item[data-value="Circuit"]');
  await expect(completer).toBeVisible();
  await expect(circuit).toBeVisible();
  expect(await completer.locator('.jp-Completer-item').count()).toBeGreaterThan(0);
  const geometry = await completer.evaluate(node => {
    const bounds = node.getBoundingClientRect();
    return {
      width: bounds.width,
      height: bounds.height,
      insideViewport:
        bounds.left >= 0 &&
        bounds.top >= 0 &&
        bounds.right <= window.innerWidth + 1 &&
        bounds.bottom <= window.innerHeight + 1
    };
  });
  expect(geometry.width).toBeGreaterThan(20);
  expect(geometry.height).toBeGreaterThan(20);
  expect(geometry.insideViewport, JSON.stringify(geometry)).toBe(true);
  await mkdir('artifacts/screenshots', { recursive: true });
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-code-completion.png`
  });

  await circuit.click();
  await expect(source).toHaveText('cascaqit.Circuit');
});

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

function blankNotebook(): Record<string, unknown> {
  return {
    cells: [{
      cell_type: 'code',
      execution_count: null,
      id: 'completion-cell',
      metadata: {},
      outputs: [],
      source: ['import cascaqit']
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
