import { expect, Locator, Page } from '@playwright/test';

export async function exerciseEditorResize(
  page: Page,
  editor: Locator
): Promise<void> {
  await expect(editor).toHaveClass(/is-resize-ready/);
  const notebook = page.locator('.jp-Notebook:visible');
  const initialEditor = await editor.boundingBox();
  const initialNotebook = await notebook.boundingBox();
  expect(initialEditor).not.toBeNull();
  expect(initialNotebook).not.toBeNull();
  const initialState = await editor.evaluate(node => {
    const computed = getComputedStyle(node);
    const ancestors: Array<Record<string, string>> = [];
    let ancestor = node.parentElement;
    while (ancestor !== null) {
      ancestors.push({
        id: ancestor.id,
        className: ancestor.className,
        style: ancestor.getAttribute('style') ?? '',
        width: getComputedStyle(ancestor).width
      });
      ancestor = ancestor.parentElement;
    }
    return {
      dataset: { ...node.dataset },
      style: node.getAttribute('style'),
      computedWidth: computed.width,
      computedMinWidth: computed.minWidth,
      computedMaxWidth: computed.maxWidth,
      ancestors
    };
  });
  expect(
    initialEditor!.width,
    `Editor did not retain its preferred initial width: ${JSON.stringify(initialState)}`
  ).toBeGreaterThanOrEqual(860);

  const compactBoundary = initialEditor!.x + 720;
  await dragNearestHandle(
    page,
    editor,
    compactBoundary
  );
  await expect.poll(async () => (await editor.boundingBox())?.width ?? 0).toBeLessThan(800);
  const compactEditor = await editor.boundingBox();
  const expandedNotebook = await notebook.boundingBox();
  expect(compactEditor!.width).toBeLessThan(initialEditor!.width - 120);
  expect(expandedNotebook!.width).toBeGreaterThan(initialNotebook!.width + 120);
  await expect.poll(() => editorColumns(editor)).toBe(1);

  await dragNearestHandle(
    page,
    editor,
    initialEditor!.x + initialEditor!.width
  );
  await expect.poll(async () => (await editor.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(860);
  await expect.poll(() => editorColumns(editor)).toBe(2);
}

async function dragNearestHandle(
  page: Page,
  editor: Locator,
  targetX: number
): Promise<void> {
  const editorBox = await editor.boundingBox();
  expect(editorBox).not.toBeNull();
  const handles = page.locator(
    '.lm-SplitPanel[data-orientation="horizontal"] > .lm-SplitPanel-handle:not(.lm-mod-hidden)'
  );
  const boxes = await handles.evaluateAll(nodes => nodes.map((node, index) => {
    const box = node.getBoundingClientRect();
    return { index, x: box.x, y: box.y, width: box.width, height: box.height };
  }));
  const handle = boxes
    .filter(box => box.width > 0 && box.height > 0)
    .sort((left, right) =>
      Math.abs(left.x + left.width / 2 - (editorBox!.x + editorBox!.width)) -
      Math.abs(right.x + right.width / 2 - (editorBox!.x + editorBox!.width))
    )[0];
  expect(handle, `No resize handle found near editor boundary: ${JSON.stringify(boxes)}`)
    .toBeDefined();

  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetX, handle.y + handle.height / 2, { steps: 12 });
  await page.mouse.up();
}

async function editorColumns(editor: Locator): Promise<number> {
  return editor.locator('.cascaqit-Editor-body').evaluate(node =>
    getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length
  );
}
