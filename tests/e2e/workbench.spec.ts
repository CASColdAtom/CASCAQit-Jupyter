import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const SERVER = 'http://127.0.0.1:8899';

for (const kind of ['digital', 'analog']) {
  test(`workbench ${kind}: template, inline output, results and presentation`, async ({ page, request }, info) => {
    const path = `artifacts/workbench-${kind}-${info.project.name}.ipynb`;
    await page.goto(`${SERVER}/lab`);
    const template = await request.get(`${SERVER}/cascaqit/templates/${kind}`);
    expect(template.ok()).toBe(true);
    const content = await template.json();
    await page.evaluate(async ({ path, content }) => {
      const xsrf = document.cookie.match(/(?:^|; )_xsrf=([^;]*)/)?.[1] ?? '';
      const response = await fetch(`/api/contents/${path}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-XSRFToken': decodeURIComponent(xsrf) },
        body: JSON.stringify({ type: 'notebook', format: 'json', content })
      });
      if (!response.ok) { throw new Error(await response.text()); }
    }, { path, content });
    const route = info.project.name.startsWith('notebook') ? 'notebooks' :
      `lab/workspaces/workbench-${kind}-${info.project.name}/tree`;
    await page.goto(`${SERVER}/${route}/${path}`);
    const nav = page.getByRole('navigation', { name: '量子工作模式' });
    await expect(nav).toBeVisible();
    const news = page.getByRole('button', { name: 'No', exact: true });
    if (await news.isVisible()) { await news.click(); }
    await expect(page.getByTestId('workbench-run-all')).toBeEnabled();
    await page.getByTestId('workbench-run-all').click();
    const plot = page.getByTestId(kind === 'digital' ? 'digital-circuit' : 'register-plot');
    await expect(plot.first()).toBeVisible();
    await expect(page.locator('.jp-Notebook .cascaqit-Renderer')).toHaveCount(2);
    await expect(page.getByTestId('workbench-run-all')).toBeEnabled();
    expect(await plot.first().locator('svg').count() + await plot.first().locator('circle, rect, path, line').count()).toBeGreaterThan(0);

    await nav.getByRole('button', { name: '演示', exact: true }).click();
    await expect(page.locator('.cascaqit-Presentation')).toBeVisible();
    await expect(page.locator('.jp-CodeCell .jp-Cell-inputWrapper').first()).toBeHidden();
    await expect(plot.first()).toBeVisible();
    await mkdir('artifacts/screenshots', { recursive: true });
    await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-${kind}-presentation.png` });
    await nav.getByRole('button', { name: 'Notebook', exact: true }).click();
    await expect(page.locator('.cascaqit-Presentation')).toHaveCount(0);
    await expect(page.locator('.jp-CodeCell .jp-Cell-inputWrapper').first()).toBeVisible();
    await nav.getByRole('button', { name: '结果', exact: true }).click();
    const results = page.locator('.cascaqit-Workbench-detail:visible');
    await expect(results.locator('.cascaqit-Renderer')).toHaveCount(2);
    await expect(results).toContainText('运行记录均为快照');
    expect(await results.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-${kind}-results.png` });
    await results.getByRole('button', { name: '返回 Notebook', exact: true }).click();
    await expect(nav).toBeVisible();

    // Opening twice must retain a draft instead of restoring over user edits.
    const editorName = kind === 'digital' ? 'Digital' : 'Analog';
    await nav.getByRole('button', { name: editorName, exact: true }).click();
    const editor = page.locator('.cascaqit-Editor:visible');
    await expect(editor).toBeVisible();
    if (kind === 'digital') {
      await editor.getByRole('button', { name: 'Add gate', exact: true }).click();
      await expect(editor.locator('.cascaqit-Editor-gate')).toHaveCount(3);
      // Command is exposed in the notebook toolbar on both frontends.
      await nav.getByRole('button', { name: 'Digital', exact: true }).click();
      await expect(editor.locator('.cascaqit-Editor-gate')).toHaveCount(3);
    }
  });
}

test('home creates a fresh notebook and code reports actual availability', async ({ page, request }, info) => {
  test.skip(!info.project.name.startsWith('lab'));
  await page.goto(`${SERVER}/lab/workspaces/home-${info.project.name}-${Date.now()}`);
  const home = page.locator('#cascaqit-workbench');
  await expect(home).toBeVisible();
  const news = page.getByRole('button', { name: 'No', exact: true });
  if (await news.isVisible()) { await news.click(); }
  await expect(page.locator('#jupyterlab-splash')).toBeHidden();
  await expect(home.locator('.cascaqit-Home-capability')).toHaveCount(4);
  await expect(home.locator('.cascaqit-Home-files')).not.toContainText('正在读取');
  await expect(home.locator('.cascaqit-Home-art svg')).toHaveCount(2);
  expect(await home.locator('.cascaqit-Home-art svg').first().locator('line, rect, circle').count()).toBeGreaterThan(5);
  expect(await home.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
  await home.getByRole('button', { name: '浏览项目文件', exact: true }).click();
  await expect(page.locator('#filebrowser')).toBeVisible();
  await page.getByRole('tab', { name: /File Browser/ }).click();
  await home.getByRole('button', { name: '创建 Digital 实验', exact: true }).focus();
  await expect(home.getByRole('button', { name: '创建 Digital 实验', exact: true })).toBeFocused();
  expect(await home.getByRole('button', { name: '创建 Digital 实验', exact: true })
    .evaluate(n => parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: `artifacts/screenshots/${info.project.name}-workbench-home.png` });
  if (info.project.name === 'lab-narrow') {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await home.evaluate(n => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: 'artifacts/screenshots/workbench-home-375.png' });
    await page.setViewportSize({ width: 640, height: 900 });
  }
  // Keep test-created notebooks in the test artifact directory.
  await page.route(/\/api\/contents\/?(?:\?.*)?$/, route => {
    if (route.request().method() === 'POST') {
      return route.continue({ url: `${SERVER}/api/contents/artifacts` });
    }
    return route.continue();
  });
  await home.getByRole('button', { name: '创建 Digital 实验', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '量子工作模式' });
  await expect(nav).toBeVisible();
  await expect(page.locator('.jp-Notebook')).toContainText('Bell 纠缠实验');
  await nav.getByRole('button', { name: 'Code', exact: true }).click();
  const capabilities = await (await request.get(`${SERVER}/cascaqit/workbench`)).json();
  if (capabilities.code_available) {
    await expect(page.getByRole('button', { name: '保存并打开 VS Code' })).toBeVisible();
    if (process.env.CASCAQIT_E2E_CODE === '1' && info.project.name === 'lab-desktop') {
      const popupPromise = page.waitForEvent('popup');
      await page.getByRole('button', { name: '保存并打开 VS Code' }).click();
      const code = await popupPromise;
      await expect(code.locator('.monaco-workbench')).toBeVisible({ timeout: 60000 });
      await expect(code.getByText('Workspace does not exist', { exact: true })).toHaveCount(0);
      const trust = code.getByRole('button', { name: /Yes, I trust the authors/ });
      if (await trust.isVisible()) { await trust.click(); }
      await expect(code.getByRole('treeitem', { name: /README.md/ }).first()).toBeVisible({ timeout: 30000 });
      await code.screenshot({ path: 'artifacts/screenshots/code-workbench.png' });
      await code.close();
    }
  } else {
    await expect(page.locator('.cascaqit-Workbench-detail')).toContainText('Code 服务未安装或未启用');
  }
});
