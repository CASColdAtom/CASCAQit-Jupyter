import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const SERVER_URL = 'http://127.0.0.1:8899';
const NOTEBOOK_PATH = 'examples/read_only_renderers.ipynb';

test('renders every read-only domain view without overflow or executable markup', async ({
  page
}, testInfo) => {
  const notebookFrontend = testInfo.project.name.startsWith('notebook');
  const route = notebookFrontend
    ? 'tree'
    : `lab/workspaces/cascaqit-renderers-${testInfo.project.name}/tree`;
  await page.goto(`${SERVER_URL}/${route}/${NOTEBOOK_PATH}`);

  const renderers = page.locator('.cascaqit-Renderer');
  await expect(renderers).toHaveCount(7);
  const newsPrompt = page.getByRole('button', { name: 'No', exact: true });
  if (await newsPrompt.isVisible()) {
    await newsPrompt.click();
  }
  await expect(page.getByTestId('digital-circuit')).toHaveCount(1);
  await expect(page.getByTestId('counts-chart')).toHaveCount(2);
  await expect(page.getByTestId('register-plot')).toHaveCount(2);
  await expect(page.getByTestId('pulse-plot')).toHaveCount(2);

  const securityDiagnostic = page.locator('.cascaqit-Diagnostic', {
    hasText: 'E2E_UNTRUSTED_TEXT'
  });
  await expect(securityDiagnostic).toContainText('<img src=x');
  await expect(securityDiagnostic.locator('img, script')).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, '__cascaqitXss'))).toBeUndefined();

  const geometry = await renderers.evaluateAll(nodes =>
    nodes.map(node => {
      const renderer = node as HTMLElement;
      const output = renderer.parentElement;
      const rect = renderer.getBoundingClientRect();
      const outputRect = output?.getBoundingClientRect();
      return {
        height: rect.height,
        width: rect.width,
        contained: outputRect === undefined || rect.right <= outputRect.right + 1,
        noOuterOverflow: renderer.scrollWidth <= renderer.clientWidth + 1
      };
    })
  );
  expect(geometry.every(item => item.width > 250 && item.height > 100)).toBe(true);
  expect(geometry.every(item => item.contained && item.noOuterOverflow)).toBe(true);

  const metricLayouts = await page.locator('.cascaqit-Renderer-metrics').evaluateAll(nodes =>
    nodes.map(node => {
      const style = getComputedStyle(node);
      return {
        columns: style.gridTemplateColumns.trim().split(/\s+/).length,
        display: style.display,
        floatsCleared: Array.from(node.querySelectorAll('dt, dd')).every(
          item => getComputedStyle(item).float === 'none'
        )
      };
    })
  );
  expect(metricLayouts).toHaveLength(3);
  expect(metricLayouts.every(item => item.display === 'grid' && item.floatsCleared)).toBe(
    true
  );
  if (testInfo.project.name.endsWith('narrow')) {
    expect(metricLayouts.every(item => item.columns === 1)).toBe(true);
  } else {
    expect(metricLayouts.every(item => item.columns >= 3)).toBe(true);
  }

  const headersDoNotOverlap = await renderers.evaluateAll(nodes =>
    nodes.every(node => {
      const header = node.querySelector('.cascaqit-Renderer-header');
      if (header === null || header.children.length < 2) {
        return false;
      }
      const first = header.children[0].getBoundingClientRect();
      const second = header.children[1].getBoundingClientRect();
      return first.bottom <= second.top || second.bottom <= first.top || first.right <= second.left;
    })
  );
  expect(headersDoNotOverlap).toBe(true);

  const analogGrid = renderers.filter({ hasText: 'program.e2e.analog' }).locator(
    '.cascaqit-Renderer-domainGrid'
  );
  const columns = await analogGrid.evaluate(node => getComputedStyle(node).gridTemplateColumns);
  if (testInfo.project.name.endsWith('narrow')) {
    expect(columns.trim().split(/\s+/)).toHaveLength(1);
  } else {
    expect(columns.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
  }

  const svgPixelCounts = await page.locator('[data-cascaqit-nonempty="true"]').evaluateAll(
    async nodes =>
      Promise.all(
        nodes.map(async node => {
          const source = node as SVGSVGElement;
          const clone = source.cloneNode(true) as SVGSVGElement;
          const sourceNodes = [source, ...source.querySelectorAll('*')];
          const cloneNodes = [clone, ...clone.querySelectorAll('*')];
          sourceNodes.forEach((item, index) => {
            const computed = getComputedStyle(item);
            const target = cloneNodes[index] as SVGElement;
            for (const property of [
              'background-color',
              'fill',
              'font-family',
              'font-size',
              'font-weight',
              'stroke',
              'stroke-dasharray',
              'stroke-width',
              'text-anchor'
            ]) {
              target.style.setProperty(property, computed.getPropertyValue(property));
            }
          });
          clone.setAttribute('width', '640');
          clone.setAttribute('height', '420');
          const markup = new XMLSerializer().serializeToString(clone);
          const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
          try {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = 320;
            canvas.height = 210;
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
        })
      )
  );
  expect(svgPixelCounts).toHaveLength(7);
  expect(svgPixelCounts.every(count => count > 150)).toBe(true);

  await mkdir('artifacts/screenshots', { recursive: true });
  for (let index = 0; index < (await renderers.count()); index += 1) {
    const renderer = renderers.nth(index);
    await renderer.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `artifacts/screenshots/${testInfo.project.name}-viewport-${index + 1}.png`
    });
  }
});
