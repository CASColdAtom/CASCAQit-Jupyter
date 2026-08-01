import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

import { exerciseEditorResize } from './workspace';

const SERVER_URL = 'http://127.0.0.1:8899';

test('compiles, runs, restores, validates, and detaches an Analog program', async ({
  page,
  request
}, testInfo) => {
  const notebookFrontend = testInfo.project.name.startsWith('notebook');
  const desktop = testInfo.project.name.endsWith('desktop');
  const workspace = `cascaqit-analog-${testInfo.project.name}`;
  const route = notebookFrontend ? 'tree' : `lab/workspaces/${workspace}/tree`;
  const notebookPath = `artifacts/analog-${testInfo.project.name}.ipynb`;
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

  await openAnalogEditor(page);
  const editor = page.locator('.cascaqit-AnalogEditor');
  await expect(editor).toBeVisible();
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Draft');
  if (desktop) {
    await exerciseEditorResize(page, editor);
  }
  await expect(editor.locator('.cascaqit-AnalogEditor-site')).toHaveCount(2);
  await expect(editor.locator('.cascaqit-AnalogEditor-segment')).toHaveCount(5);

  await editor.getByLabel('Register shape').selectOption('rectangle');
  await editor.getByLabel('Rows').fill('2');
  await editor.getByLabel('Columns').fill('3');
  await editor.getByLabel('X spacing (um)').fill('5');
  await editor.getByLabel('Y spacing (um)').fill('6');
  await editor.getByLabel('Center x (um)').fill('0');
  await editor.getByLabel('Center y (um)').fill('0');
  await editor.getByTestId('apply-register-layout').click();
  await expect(editor.locator('.cascaqit-AnalogEditor-site')).toHaveCount(6);
  await expect(editor.getByTestId('analog-waveform-preview').locator('canvas').first())
    .toBeVisible();
  await expect(editor.getByTestId('analog-waveform-preview'))
    .toHaveAttribute('data-cascaqit-bokeh-plots', '1');
  await expect(editor.getByTestId('analog-waveform-preview'))
    .toHaveAttribute('data-cascaqit-bokeh-channels', '3');

  await editor.getByTestId('generate-analog-cell').click();
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Ready');
  await expect(editor).toContainText('generated Analog code cell synchronized');

  const generated = page
    .locator('.jp-CodeCell')
    .filter({ hasText: 'MockNeutralAtomTarget' })
    .first();
  await expect(generated).toContainText('AHSProgram');

  await editor.getByLabel('Shots').fill('32');
  await editor.getByLabel('Seed').fill('2026');
  await editor.getByLabel('Time steps').fill('80');
  await editor.getByTestId('run-job').click();
  await expect(editor.getByTestId('job-status')).toContainText('Completed');
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Completed');
  const result = editor.getByTestId('job-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Probabilities');
  await expect(result).toContainText('Simulation resources');
  await expect(result).toContainText('Offline deterministic');
  await expect(result).toContainText('32');
  expect(await embeddedResultFits(result)).toBe(true);
  expect(await rendererHeaderFits(result)).toBe(true);
  const firstJobId = await editor.getByTestId('job-status').locator('code').textContent();

  const initialPhaseEnd = editor
    .locator('[data-object-path="editor_model.controls.phase"]')
    .getByLabel('End');
  await initialPhaseEnd.fill('0.2');
  await initialPhaseEnd.press('Tab');
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Draft');
  await expect(editor.getByTestId('job-status')).toContainText('Not run');
  await expect(editor.getByTestId('job-result')).toHaveCount(0);
  await expect(editor.getByTestId('run-job')).toHaveText('Update & Run');
  await expect(editor.getByTestId('run-job')).toBeEnabled();
  await editor.getByTestId('run-job').click();
  await expect(editor.getByTestId('job-status')).toContainText('Completed');
  await expect(generated).toContainText('values=[0.0, 0.2]');
  const secondJobId = await editor.getByTestId('job-status').locator('code').textContent();
  expect(secondJobId).not.toBe(firstJobId);

  await result.evaluate(node => node.scrollIntoView({ block: 'center' }));
  await mkdir('artifacts/screenshots', { recursive: true });
  await editor.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-analog-job.png`
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
    return Array.isArray(savedNotebook?.cells) && savedNotebook.cells.some(
      (cell: any) =>
        cell.metadata?.cascaqit_jupyter?.editor_document?.program_kind === 'analog' &&
        cell.metadata?.cascaqit_jupyter?.editor_document?.metadata?.last_job?.state === 'completed'
    );
  }).toBe(true);
  const savedCell = savedNotebook.cells.find(
    (cell: any) => cell.metadata?.cascaqit_jupyter?.editor_document?.program_kind === 'analog'
  );
  expect(savedCell.metadata.cascaqit_jupyter.editor_document.metadata.last_job)
    .toMatchObject({ state: 'completed', seed: 2026, shots: 32, analog_time_steps: 80 });
  expect(
    savedCell.metadata.cascaqit_jupyter.editor_document.metadata.last_job.result.result_id
  ).toMatch(/^result\./);

  await page.reload();
  await expect(page.locator('.jp-Notebook:visible')).toBeVisible();
  await openAnalogEditor(page);
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Completed');
  await expect(editor).toContainText('Restored from generated cell metadata');
  await expect(editor.getByTestId('job-status')).toContainText('Completed');
  await expect(editor.getByTestId('job-status')).toContainText('jupyter_job.analog.');
  await expect(editor.getByTestId('generate-analog-cell')).toHaveText('Update cell');

  const site0X = Number(await editor.getByLabel('Site s0 x in micrometers').inputValue());
  const siteX = editor.getByLabel('Site s1 x in micrometers');
  const site1X = await siteX.inputValue();
  await siteX.fill(String(site0X + 1));
  await siteX.press('Tab');
  await editor.getByTestId('generate-analog-cell').click();
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Invalid');
  const invalidReason = editor.getByTestId('editor-diagnostics');
  await expect(invalidReason).toBeInViewport();
  await expect(invalidReason).toContainText('ATOM_SPACING_TOO_SMALL');
  await expect(invalidReason).toContainText(
    'Atoms s0 and s1 are separated by 1.0, below 3.0.'
  );
  await expect(invalidReason).toContainText(
    'Increase atom spacing or remove one atom.'
  );
  await expect(
    editor.locator('[data-object-path="editor_model.register.sites"]')
  ).toHaveClass(/has-diagnostic/);
  await expect(editor.locator('.cascaqit-AnalogEditor-site.has-diagnostic')).toHaveCount(0);

  const geometry = await editor.evaluate(node => {
    const body = node.querySelector<HTMLElement>('.cascaqit-Editor-body');
    const previews = Array.from(
      node.querySelectorAll<HTMLElement>('.cascaqit-Editor-preview')
    );
    return {
      width: node.getBoundingClientRect().width,
      height: node.getBoundingClientRect().height,
      columns: body === null
        ? 0
        : getComputedStyle(body).gridTemplateColumns.trim().split(/\s+/).length,
      noOverflow: node.scrollWidth <= node.clientWidth + 1,
      previewsFit: previews.every(
        preview => preview.scrollWidth <= preview.clientWidth + 1
      ),
      controlsFit: Array.from(node.querySelectorAll('button, input'))
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
  expect(geometry.height).toBeGreaterThan(500);
  expect(geometry.noOverflow, JSON.stringify(geometry)).toBe(true);
  if (desktop) {
    expect(geometry.previewsFit, JSON.stringify(geometry)).toBe(true);
  }
  expect(geometry.controlsFit, JSON.stringify(geometry)).toBe(true);

  const registerPixels = await visibleSvgPixels(
    editor.getByTestId('analog-register-preview').locator('svg')
  );
  expect(registerPixels, 'analog-register-preview').toBeGreaterThan(100);
  const waveformPixels = await visibleCanvasPixels(
    editor.getByTestId('analog-waveform-preview').locator('canvas')
  );
  expect(waveformPixels, 'analog-waveform-preview').toBeGreaterThan(100);
  await editor.evaluate(node => node.scrollTo({ top: 0 }));
  await page.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-analog-layout.png`
  });
  await editor.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-analog-editor.png`
  });

  await siteX.fill(site1X);
  await siteX.press('Tab');
  await editor.getByTestId('generate-analog-cell').click();
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Ready');
  const restoredGenerated = page
    .locator('.jp-CodeCell')
    .filter({ hasText: 'MockNeutralAtomTarget' })
    .first()
    .locator('.cm-content');
  await restoredGenerated.click();
  await restoredGenerated.press('Control+End');
  await restoredGenerated.press('Enter');
  await restoredGenerated.type('# user Analog change');
  const phaseEnd = editor
    .locator('[data-object-path="editor_model.controls.phase"]')
    .getByLabel('End');
  await phaseEnd.fill('0.1');
  await phaseEnd.press('Tab');
  await editor.getByTestId('generate-analog-cell').click();
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Detached');
  await expect(restoredGenerated).toContainText('# user Analog change');
  await expect(restoredGenerated).not.toContainText('0.1');
});

async function visibleSvgPixels(locator: any): Promise<number> {
  return locator.evaluate(async (source: SVGSVGElement) => {
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
    clone.setAttribute('height', '320');
    const url = URL.createObjectURL(new Blob(
      [new XMLSerializer().serializeToString(clone)],
      { type: 'image/svg+xml' }
    ));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 160;
      const context = canvas.getContext('2d');
      if (context === null) {
        return 0;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let visible = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          data[index + 3] > 0 &&
          data[index] + data[index + 1] + data[index + 2] < 735
        ) {
          visible += 1;
        }
      }
      return visible;
    } finally {
      URL.revokeObjectURL(url);
    }
  });
}

async function visibleCanvasPixels(locator: any): Promise<number> {
  return locator.evaluateAll((canvases: HTMLCanvasElement[]) => {
    return Math.max(0, ...canvases.map(source => {
      const context = source.getContext('2d');
      if (context === null || source.width === 0 || source.height === 0) {
        return 0;
      }
      const data = context.getImageData(0, 0, source.width, source.height).data;
      let visible = 0;
      for (let index = 0; index < data.length; index += 4) {
        if (
          data[index + 3] > 0 &&
          data[index] + data[index + 1] + data[index + 2] < 735
        ) {
          visible += 1;
        }
      }
      return visible;
    }));
  });
}

async function openAnalogEditor(page: any): Promise<void> {
  await expect(async () => {
    await page.locator('.jp-Notebook:visible').focus();
    await page.keyboard.press('Alt+Shift+A');
    await expect(page.locator('.cascaqit-AnalogEditor')).toBeVisible({ timeout: 1000 });
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

async function rendererHeaderFits(result: any): Promise<boolean> {
  return result.locator('.cascaqit-Renderer-header').evaluate((header: HTMLElement) => {
    const bounds = header.getBoundingClientRect();
    const title = header.firstElementChild?.getBoundingClientRect();
    const identity = header.lastElementChild?.getBoundingClientRect();
    if (title === undefined || identity === undefined) {
      return false;
    }
    const separated = title.bottom <= identity.top ||
      identity.bottom <= title.top ||
      title.right <= identity.left;
    return separated && identity.left >= bounds.left - 1 &&
      identity.right <= bounds.right + 1;
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
    cells: [{
      cell_type: 'code',
      execution_count: null,
      id: 'analog-start',
      metadata: {},
      outputs: [],
      source: []
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
