import type { JupyterFrontEnd } from '@jupyterlab/application';
import type { IDocumentManager } from '@jupyterlab/docmanager';
import { Widget } from '@lumino/widgets';
import type { ShellMode } from './shell_mode';

const PREFIX = 'cascaqit-Home';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, name = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = name ? `${PREFIX}-${name}` : '';
  element.textContent = text;
  return element;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text = ''): SVGElementTagNameMap[K] {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
  element.textContent = text;
  return element;
}

/** Template illustrations use local SVG only; no font/network dependency. */
function illustration(kind: 'digital' | 'analog'): SVGSVGElement {
  const root = svg('svg', { viewBox: '0 0 400 140', role: 'img',
    'aria-label': kind === 'digital' ? 'Bell 模板：H、受控 X 和两个末端测量' : '双原子模板：5 微米间距、恒定 Rabi 与线性失谐' });
  if (kind === 'digital') {
    for (const [i, y] of [46, 98].entries()) {
      root.append(svg('text', { x: 18, y: y + 5, class: 'wire-label' }, `q${i}`),
        svg('line', { x1: 58, y1: y, x2: 378, y2: y, class: 'wire' }));
      root.append(svg('rect', { x: 302, y: y - 17, width: 40, height: 34, rx: 5, class: 'gate measurement' }),
        svg('text', { x: 322, y: y + 5, class: 'gate-label' }, 'M'));
    }
    root.append(svg('rect', { x: 88, y: 29, width: 40, height: 34, rx: 5, class: 'gate' }),
      svg('text', { x: 108, y: 51, class: 'gate-label' }, 'H'),
      svg('line', { x1: 212, y1: 46, x2: 212, y2: 98, class: 'connection' }),
      svg('circle', { cx: 212, cy: 46, r: 5, class: 'control' }),
      svg('circle', { cx: 212, cy: 98, r: 12, class: 'target' }),
      svg('line', { x1: 200, y1: 98, x2: 224, y2: 98, class: 'connection' }),
      svg('line', { x1: 212, y1: 86, x2: 212, y2: 110, class: 'connection' }));
  } else {
    root.append(svg('line', { x1: 60, y1: 68, x2: 156, y2: 68, class: 'wire', 'stroke-dasharray': '4 4' }));
    for (const x of [60, 156]) {
      root.append(svg('circle', { cx: x, cy: 68, r: 22, class: 'atom-halo' }),
        svg('circle', { cx: x, cy: 68, r: 9, class: 'control' }));
    }
    root.append(svg('text', { x: 108, y: 111, class: 'gate-label' }, '5 μm'),
      svg('line', { x1: 228, y1: 30, x2: 228, y2: 108, class: 'wire' }),
      svg('line', { x1: 228, y1: 108, x2: 382, y2: 108, class: 'wire' }),
      svg('path', { d: 'M 232 49 L 376 49', class: 'pulse' }),
      svg('path', { d: 'M 232 99 L 376 29', class: 'detuning' }),
      svg('text', { x: 266, y: 130, class: 'wire-label' }, '0 → 1.2 μs'));
  }
  return root;
}

export function createWorkbenchHome(
  app: JupyterFrontEnd, documents: IDocumentManager,
  request: (path: string) => Promise<unknown>, shellMode: ShellMode
): { widget: Widget; refresh: () => Promise<void> } {
  const widget = new Widget();
  widget.id = 'cascaqit-workbench';
  widget.title.label = '量子工作台';
  widget.title.closable = true;
  widget.addClass('cascaqit-Workbench');
  widget.addClass(PREFIX);
  const feedback = el('p', 'feedback');
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  const action = (label: string, run: () => unknown | Promise<unknown>, primary = false): HTMLButtonElement => {
    const control = el('button', 'action', label);
    control.classList.add('cascaqit-Workbench-button');
    if (primary) { control.classList.add('is-primary'); }
    control.type = 'button';
    control.addEventListener('click', async () => {
      control.disabled = true;
      control.setAttribute('aria-busy', 'true');
      feedback.hidden = true;
      try { await run(); }
      catch (error) {
        feedback.textContent = `操作未完成：${error instanceof Error ? error.message : String(error)}。请重试。`;
        feedback.hidden = false;
      } finally {
        control.disabled = false;
        control.removeAttribute('aria-busy');
      }
    });
    return control;
  };
  const create = async (kind: 'digital' | 'analog'): Promise<void> => {
    feedback.textContent = '正在创建实验…';
    feedback.hidden = false;
    const template = await request(`templates/${kind}`);
    const model = await app.serviceManager.contents.newUntitled({ type: 'notebook' });
    await app.serviceManager.contents.save(model.path, { type: 'notebook', format: 'json', content: template });
    if (!documents.openOrReveal(model.path)) { throw new Error('无法打开创建的 Notebook'); }
    feedback.hidden = true;
  };
  const top = el('header', 'top');
  const brand = el('div', 'brand', 'CASCAQit');
  brand.append(el('span', '', '量子工作台'));
  top.append(brand, shellMode.button(widget));
  const main = el('main', 'main');
  const welcome = el('section', 'welcome');
  welcome.append(el('h1', '', '新建实验'),
    action('浏览项目文件', () => app.commands.execute('filebrowser:activate')));
  main.append(welcome, feedback);
  const templates = el('div', 'templates');
  for (const kind of ['digital', 'analog'] as const) {
    const digital = kind === 'digital';
    const card = el('article', `template ${PREFIX}-template-${kind}`);
    const art = el('div', 'art');
    art.append(illustration(kind));
    const body = el('div', 'templateBody');
    body.append(el('h2', '', digital ? 'Bell 纠缠实验' : '双原子实验'),
      action(digital ? '创建 Digital 实验' : '创建 Analog 实验', () => create(kind)));
    card.append(art, body);
    templates.append(card);
  }
  main.append(templates);
  const lower = el('div', 'lower');
  const project = el('section', 'panel');
  const projectHead = el('div', 'sectionHeading');
  projectHead.append(el('h2', '', '项目 Notebook'));
  const files = el('div', 'files');
  files.setAttribute('aria-label', '项目 Notebook');
  project.append(projectHead, files);
  const environment = el('details', 'environment');
  const envHead = el('summary', '', '开发环境');
  const capabilities = el('div', 'capabilities');
  capabilities.setAttribute('role', 'status');
  environment.append(envHead, capabilities);
  const tools = el('div', 'tools');
  tools.append(environment);
  if (app.commands.hasCommand('terminal:create-new')) {
    tools.append(action('打开终端', () => app.commands.execute('terminal:create-new')));
  }
  lower.append(project, tools);
  main.append(lower);
  widget.node.append(top, main);
  let generation = 0;
  const refresh = async (): Promise<void> => {
    const current = ++generation;
    files.replaceChildren(el('p', 'loading', '正在读取项目…'));
    capabilities.replaceChildren(el('p', 'loading', '正在检查环境…'));
    await Promise.all([
      (async () => {
        try {
          const directory = await app.serviceManager.contents.get('', { content: true });
          if (widget.isDisposed || current !== generation) { return; }
          const notebooks = (directory.content as Array<{ type: string; name: string; path: string; last_modified: string }>)
            .filter(file => file.type === 'notebook').sort((a, b) => b.last_modified.localeCompare(a.last_modified)).slice(0, 4);
          files.replaceChildren();
          if (!notebooks.length) {
            files.append(el('p', 'loading', '还没有 Notebook。从上方模板创建第一个实验。'));
          }
          for (const file of notebooks) {
            const row = action(file.name, () => documents.openOrReveal(file.path));
            row.classList.add(`${PREFIX}-file`);
            row.title = file.path;
            row.replaceChildren(el('span', 'fileName', file.name));
            const time = el('time', '', new Date(file.last_modified).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }));
            time.dateTime = file.last_modified;
            row.append(time);
            files.append(row);
          }
        } catch {
          if (widget.isDisposed || current !== generation) { return; }
          files.replaceChildren(el('p', 'loading', '暂时无法读取项目。'), action('重新加载项目', refresh));
        }
      })(),
      (async () => {
        try {
          const state = await request('workbench') as Record<string, unknown>;
          if (widget.isDisposed || current !== generation) { return; }
          capabilities.replaceChildren();
          for (const [name, ready] of [['Notebook 服务', true], ['浏览器 Code', state.code_available], ['Python 语言服务', state.lsp], ['Git 集成', state.git]]) {
            const row = el('div', 'capability');
            row.append(el('span', '', String(name)), el('span', ready ? 'ready' : 'optional', ready ? '可用' : '未配置'));
            capabilities.append(row);
          }
        } catch {
          if (widget.isDisposed || current !== generation) { return; }
          capabilities.replaceChildren(el('p', 'loading', '环境状态暂不可用。'), action('重新检查环境', refresh));
        }
      })()
    ]);
  };
  return { widget, refresh };
}
