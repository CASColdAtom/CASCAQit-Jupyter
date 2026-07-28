import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const SERVER_URL = 'http://127.0.0.1:8899';

test('compiles, runs, restores, validates, and detaches an Analog program', async ({
  page,
  request
}, testInfo) => {
  const notebookFrontend = testInfo.project.name.startsWith('notebook');
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
  await expect(editor.locator('.cascaqit-AnalogEditor-site')).toHaveCount(2);
  await expect(editor.locator('.cascaqit-AnalogEditor-segment')).toHaveCount(5);

  await editor.getByTestId('generate-analog-cell').click();
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Ready');
  await expect(editor).toContainText('generated Analog code cell synchronized');

  const generated = page
    .locator('.jp-CodeCell')
    .filter({ hasText: 'MockNeutralAtomTarget' })
    .first();
  await expect(generated).toContainText('AHSProgram');
  await generated.locator('.cm-content').click();
  await page.keyboard.press('Shift+Enter');
  await expect(generated.locator('.jp-InputPrompt')).toContainText('[1]');

  const analysisSource = [
    'from IPython.display import display',
    'from cascaqit.visualization import build_pulse_timeline, build_register_visualization',
    'from cascaqit_jupyter import display_program, display_result, display_visualization',
    'result = builder.run(shots=32, seed=2026, time_steps=80)',
    'display(display_program(program))',
    'display(display_result(result))',
    'display(display_visualization(build_register_visualization(program)))',
    'display(display_visualization(build_pulse_timeline(program)))'
  ].join('\n');
  const activeCell = page.locator('.jp-CodeCell.jp-mod-active .cm-content');
  await expect(activeCell).toBeVisible();
  await activeCell.click();
  await page.keyboard.insertText(analysisSource);
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('.cascaqit-Renderer')).toHaveCount(4);
  await expect(page.getByTestId('register-plot')).toHaveCount(2);
  await expect(page.getByTestId('pulse-plot')).toHaveCount(2);
  await expect(page.locator('.cascaqit-Renderer').filter({ hasText: 'Observed states' }))
    .toContainText('32');

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
        cell.metadata?.cascaqit_jupyter?.editor_document?.program_kind === 'analog'
    );
  }).toBe(true);

  await page.reload();
  await expect(page.locator('.jp-Notebook:visible')).toBeVisible();
  await openAnalogEditor(page);
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Ready');
  await expect(editor).toContainText('Restored from generated cell metadata');
  await expect(editor.getByTestId('generate-analog-cell')).toHaveText('Update cell');

  const siteX = editor.getByLabel('Site s1 x in micrometers');
  await siteX.fill('1');
  await siteX.press('Tab');
  await editor.getByTestId('generate-analog-cell').click();
  await expect(editor.getByTestId('analog-editor-status')).toHaveText('Invalid');
  await expect(editor).toContainText('ATOM_SPACING_TOO_SMALL');
  await expect(
    editor.locator('[data-object-path="editor_model.register.sites"]')
  ).toHaveClass(/has-diagnostic/);
  await expect(editor.locator('.cascaqit-AnalogEditor-site.has-diagnostic')).toHaveCount(0);

  const geometry = await editor.evaluate(node => ({
    width: node.getBoundingClientRect().width,
    height: node.getBoundingClientRect().height,
    noOverflow: node.scrollWidth <= node.clientWidth + 1,
    controlsFit: Array.from(node.querySelectorAll('button, input'))
      .filter(control => !(control as HTMLElement).hidden)
      .every(control => {
        const box = control.getBoundingClientRect();
        if (control instanceof HTMLInputElement && control.type === 'checkbox') {
          return box.width >= 12 && box.height >= 12;
        }
        return box.width > 20 && box.height >= 26;
      })
  }));
  expect(geometry.width).toBeGreaterThanOrEqual(240);
  expect(geometry.height).toBeGreaterThan(500);
  expect(geometry.noOverflow, JSON.stringify(geometry)).toBe(true);
  expect(geometry.controlsFit, JSON.stringify(geometry)).toBe(true);

  for (const testId of ['analog-register-preview', 'analog-waveform-preview']) {
    const pixels = await visibleSvgPixels(editor.getByTestId(testId).locator('svg'));
    expect(pixels, testId).toBeGreaterThan(100);
  }
  await mkdir('artifacts/screenshots', { recursive: true });
  await editor.screenshot({
    path: `artifacts/screenshots/${testInfo.project.name}-analog-editor.png`
  });

  await siteX.fill('5');
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

async function openAnalogEditor(page: any): Promise<void> {
  await expect(async () => {
    await page.locator('.jp-Notebook:visible').focus();
    await page.keyboard.press('Alt+Shift+A');
    await expect(page.locator('.cascaqit-AnalogEditor')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000, intervals: [500] });
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
