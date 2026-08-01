import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const SERVER_URL = 'http://127.0.0.1:8899';

test('creates, restores, and detaches a Digital generated cell', async ({
  page,
  request
}, testInfo) => {
  const notebookFrontend = testInfo.project.name.startsWith('notebook');
  const desktop = testInfo.project.name.endsWith('desktop');
  const workspace = `cascaqit-editor-${testInfo.project.name}`;
  const route = notebookFrontend ? 'tree' : `lab/workspaces/${workspace}/tree`;
  const notebookPath = `artifacts/e2e-${testInfo.project.name}.ipynb`;
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

  await openEditor(page);
  const editor = page.locator('.cascaqit-Editor');
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('editor-status')).toHaveText('Draft');

  await editor.getByRole('button', { name: 'Add qubit' }).click();
  await editor.getByRole('button', { name: 'Add gate' }).click();
  await editor.getByLabel('Gate', { exact: true }).selectOption('cx');
  await editor.getByLabel('Control qubit').selectOption('q0');
  await editor.getByLabel('Target qubit').selectOption('q1');
  await editor.getByRole('button', { name: 'Add gate' }).click();
  await editor.getByLabel('Gate', { exact: true }).selectOption('ccx');
  await editor.getByLabel('First control qubit').selectOption('q0');
  await editor.getByLabel('Second control qubit').selectOption('q1');
  await editor.getByLabel('Target qubit').selectOption('q2');
  await editor.getByRole('button', { name: 'Add gate' }).click();
  await expect(editor.locator('.cascaqit-Editor-gate')).toHaveCount(3);
  await expect(editor.getByTestId('editor-circuit-preview').locator(
    '[data-role="control"]'
  )).toHaveCount(3);
  await expect(editor.getByTestId('editor-circuit-preview').locator(
    '[data-role="target"]'
  )).toHaveCount(2);

  await editor.getByTestId('generate-cell').click();
  await expect(editor.getByTestId('editor-status')).toHaveText('Ready');
  await expect(editor).toContainText('generated code cell synchronized');

  await editor.getByLabel('Shots').fill('32');
  await editor.getByLabel('Seed').fill('2026');
  await editor.getByTestId('run-job').click();
  await expect(editor.getByTestId('job-status')).toContainText('Completed');
  await expect(editor.getByTestId('editor-status')).toHaveText('Completed');
  const result = editor.getByTestId('job-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Probabilities');
  await expect(result).toContainText('Observables');
  await expect(result).toContainText('Simulation resources');
  await expect(result).toContainText('Offline deterministic');
  await expect(result).toContainText('2026');
  expect(await embeddedResultFits(result)).toBe(true);
  await result.evaluate(node => node.scrollIntoView({ block: 'center' }));
  await mkdir('artifacts/screenshots', { recursive: true });
  await editor.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-digital-job.png`
  });

  await page.locator('.jp-Notebook:visible').focus();
  await page.keyboard.press('Meta+S');
  let savedNotebook: any;
  await expect.poll(async () => {
    const response = await request.get(`${SERVER_URL}/api/contents/${notebookPath}`);
    if (!response.ok()) {
      return false;
    }
    savedNotebook = (await response.json()).content;
    if (!Array.isArray(savedNotebook?.cells)) {
      return false;
    }
    return savedNotebook.cells.some(
      (cell: any) =>
        cell.metadata?.cascaqit_jupyter?.editor_document?.compile_status === 'completed'
    );
  }).toBe(true);
  const savedCell = savedNotebook.cells.find(
    (cell: any) => cell.metadata?.cascaqit_jupyter?.editor_document
  );
  const savedSource = Array.isArray(savedCell.source)
    ? savedCell.source.join('')
    : savedCell.source;
  expect(savedSource).toContain('circuit.h("q0")');
  expect(savedSource).toContain('circuit.cx("q0", "q1")');
  expect(savedSource).toContain('circuit.ccx("q0", "q1", "q2")');
  expect(savedCell.metadata.cascaqit_jupyter.editor_document.metadata.last_job)
    .toMatchObject({ state: 'completed', seed: 2026, shots: 32 });
  expect(
    savedCell.metadata.cascaqit_jupyter.editor_document.metadata.last_job.result.result_id
  ).toMatch(/^result\./);

  await page.reload();
  await expect(page.locator('.jp-Notebook:visible')).toBeVisible();
  await openEditor(page);
  await expect(editor.getByTestId('editor-status')).toHaveText('Completed');
  await expect(editor).toContainText('Restored from generated cell metadata');
  await expect(editor.getByTestId('job-status')).toContainText('Completed');
  await expect(editor.getByTestId('job-status')).toContainText('jupyter_job.digital.');
  await expect(editor.getByTestId('generate-cell')).toHaveText('Update cell');

  const code = page
    .locator('.jp-CodeCell')
    .filter({ hasText: 'circuit.h' })
    .first()
    .locator('.cm-content');
  await code.click();
  await code.press('Control+End');
  await code.press('Enter');
  await code.type('# user change');
  await expect(code).toContainText('# user change');

  await editor.getByLabel('Gate', { exact: true }).selectOption('x');
  await editor.getByRole('button', { name: 'Add gate' }).click();
  await editor.getByTestId('generate-cell').click();
  await expect(editor.getByTestId('editor-status')).toHaveText('Detached');
  await expect(editor).toContainText('contains user changes');
  await expect(code).toContainText('# user change');
  await expect(code).not.toContainText('circuit.x("q0")');

  const geometry = await editor.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const body = node.querySelector<HTMLElement>('.cascaqit-Editor-body');
    return {
      width: rect.width,
      height: rect.height,
      columns: body === null
        ? 0
        : getComputedStyle(body).gridTemplateColumns.trim().split(/\s+/).length,
      noOverflow: node.scrollWidth <= node.clientWidth + 1,
      controlsFit: Array.from(node.querySelectorAll('button, input, select'))
        .filter(control => !(control as HTMLElement).hidden)
        .every(control => {
          const box = control.getBoundingClientRect();
          if (control instanceof HTMLInputElement && control.type === 'checkbox') {
            return box.width >= 12 && box.height >= 12;
          }
          return box.width > 20 && box.height >= 26;
        })
    };
  });
  const [editorBounds, notebookBounds] = await Promise.all([
    editor.boundingBox(),
    page.locator('.jp-Notebook:visible').boundingBox()
  ]);
  expect(editorBounds).not.toBeNull();
  expect(notebookBounds).not.toBeNull();
  expect(editorBounds!.x).toBeLessThan(notebookBounds!.x);
  expect(geometry.width).toBeGreaterThanOrEqual(desktop ? 900 : 280);
  expect(geometry.columns).toBe(desktop ? 2 : 1);
  expect(geometry.height).toBeGreaterThan(300);
  expect(geometry.noOverflow, JSON.stringify(geometry)).toBe(true);
  expect(geometry.controlsFit, JSON.stringify(geometry)).toBe(true);

  const visiblePixels = await editor
    .getByTestId('editor-circuit-preview')
    .locator('svg')
    .evaluate(async source => {
      const clone = source.cloneNode(true) as SVGSVGElement;
      const sourceNodes = [source, ...source.querySelectorAll('*')];
      const cloneNodes = [clone, ...clone.querySelectorAll('*')];
      sourceNodes.forEach((item, index) => {
        const computed = getComputedStyle(item);
        const target = cloneNodes[index] as SVGElement;
        for (const property of ['fill', 'stroke', 'stroke-width', 'font-size']) {
          target.style.setProperty(property, computed.getPropertyValue(property));
        }
      });
      clone.setAttribute('width', '640');
      clone.setAttribute('height', '240');
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(clone)], {
          type: 'image/svg+xml'
        })
      );
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 120;
        const context = canvas.getContext('2d');
        if (context === null) {
          return 0;
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let visible = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (
            pixels[index + 3] > 0 &&
            pixels[index] + pixels[index + 1] + pixels[index + 2] < 735
          ) {
            visible += 1;
          }
        }
        return visible;
      } finally {
        URL.revokeObjectURL(url);
      }
    });
  expect(visiblePixels).toBeGreaterThan(100);

  await editor.evaluate(node => node.scrollTo({ top: 0 }));
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-digital-layout.png`
  });
  await editor.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-digital-editor.png`
  });
});

async function openEditor(page: any): Promise<void> {
  await expect(async () => {
    const notebook = page.locator('.jp-Notebook:visible');
    await notebook.focus();
    await page.keyboard.press('Alt+Shift+Q');
    await expect(page.locator('.cascaqit-Editor')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000, intervals: [500] });
}

async function embeddedResultFits(result: any): Promise<boolean> {
  return result.evaluate((node: HTMLElement) => {
    const bounds = node.getBoundingClientRect();
    return Array.from(node.querySelectorAll(
      '.cascaqit-Renderer, .cascaqit-Renderer-sectionHeading, .cascaqit-Renderer-sectionHeading > *'
    ))
      .every(item => {
        const rect = item.getBoundingClientRect();
        return rect.left >= bounds.left - 1 &&
          rect.right <= bounds.right + 1 &&
          item.scrollWidth <= item.clientWidth + 1;
      });
  });
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

function blankNotebook(): Record<string, unknown> {
  return {
    cells: [
      {
        cell_type: 'code',
        execution_count: null,
        id: 'editor-start',
        metadata: {},
        outputs: [],
        source: []
      }
    ],
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
