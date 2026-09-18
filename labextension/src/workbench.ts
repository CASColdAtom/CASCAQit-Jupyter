import { ILabShell, JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ICommandPalette } from '@jupyterlab/apputils';
import { PageConfig, URLExt } from '@jupyterlab/coreutils';
import { IDocumentManager } from '@jupyterlab/docmanager';
import { ILauncher } from '@jupyterlab/launcher';
import { INotebookTracker, NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { ServerConnection } from '@jupyterlab/services';
import { Widget } from '@lumino/widgets';

import { renderPayload } from './renderer';
import { workbenchRuns } from './workbench_runs';
import { createWorkbenchHome } from './workbench_home';
import { ShellMode } from './shell_mode';

const HOME = 'cascaqit:workbench';
const settings = ServerConnection.makeSettings();
const MIME_PREFIX = 'application/vnd.cascaqit.';

export async function workbenchRequest(path: string): Promise<unknown> {
  const response = await ServerConnection.makeRequest(
    URLExt.join(settings.baseUrl, 'cascaqit', path), {}, settings
  );
  if (!response.ok) {
    throw new Error('工作台服务尚未就绪，请确认安装新版 cascaqit-jupyter 并重启 Jupyter 服务。');
  }
  return response.json();
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, className = '', text = ''
): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  value.className = className;
  value.textContent = text;
  return value;
}

function button(label: string, action: () => void | Promise<unknown>): HTMLButtonElement {
  const value = node('button', 'cascaqit-Workbench-button', label);
  value.type = 'button';
  value.addEventListener('click', () => { void action(); });
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Per-notebook controller: views never replace the notebook model or execute on navigation. */
class NotebookWorkspace {
  constructor(
    private app: JupyterFrontEnd,
    private panel: NotebookPanel,
    private labShell: ILabShell | null,
    shellMode: ShellMode
  ) {
    const bar = node('div', 'cascaqit-Workbench-nav');
    const nav = node('nav');
    nav.setAttribute('aria-label', '量子工作模式');
    for (const [label, action] of [
      ['工作台', () => app.commands.execute(HOME)],
      ['Notebook', () => this.showNotebook()],
      ['Digital', () => this.openEditor('digital')],
      ['Analog', () => this.openEditor('analog')],
      ['Code', () => this.showCode()],
      ['结果', () => this.showResults()],
      ['演示', () => this.togglePresentation()]
    ] as Array<[string, () => void | Promise<unknown>]>) {
      const control = button(label, () => this.perform(action));
      control.dataset.mode = label;
      control.setAttribute('aria-pressed', String(label === 'Notebook'));
      nav.append(control);
    }
    const execution = node('div', 'cascaqit-Workbench-execution');
    this.run = button('运行全部', () => this.perform(async () => {
      if (panel.sessionContext.isReady && panel.sessionContext.session?.kernel) {
        this.run.disabled = true;
        await NotebookActions.runAll(panel.content, panel.sessionContext);
        await panel.context.save();
      }
      this.updateStatus();
    }));
    this.run.dataset.testid = 'workbench-run-all';
    execution.append(this.status, this.run, shellMode.button(this.header));
    this.status.setAttribute('role', 'status');
    this.status.dataset.testid = 'workbench-kernel-status';
    this.feedback.setAttribute('role', 'status');
    this.feedback.hidden = true;
    bar.append(nav, execution, this.feedback);
    this.header.node.append(bar);
    // Lumino needs an explicit minimum for a widget with intrinsic HTML content.
    this.resizeObserver = new ResizeObserver(() => {
      this.header.node.style.minHeight = `${Math.ceil(bar.getBoundingClientRect().height)}px`;
      this.header.parent?.fit();
    });
    this.resizeObserver.observe(bar);
    panel.contentHeader.addWidget(this.header);
    panel.sessionContext.statusChanged.connect(this.updateStatus, this);
    panel.sessionContext.connectionStatusChanged.connect(this.updateStatus, this);
    panel.sessionContext.kernelChanged.connect(this.updateStatus, this);
    panel.context.pathChanged.connect(this.updateStatus, this);
    void panel.sessionContext.ready.then(() => this.updateStatus());
    panel.disposed.connect(() => this.dispose());
    this.updateStatus();
  }

  private updateStatus(): void {
    if (this.panel.isDisposed) { return; }
    const session = this.panel.sessionContext;
    const kernel = session.session?.kernel;
    const connected = kernel?.connectionStatus === 'connected';
    const state = connected ? kernel?.status : kernel ? 'disconnected' : 'no kernel';
    this.status.textContent = `Python · ${state}`;
    this.run.disabled = !session.isReady || !connected || kernel?.status !== 'idle';
  }

  private async perform(action: () => void | Promise<unknown>): Promise<void> {
    this.feedback.hidden = true;
    try { await action(); }
    catch (error) {
      this.feedback.textContent = error instanceof Error ? error.message : String(error);
      this.feedback.hidden = false;
      this.updateStatus();
    }
  }

  private markMode(mode: string): void {
    this.header.node.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(control => {
      control.setAttribute('aria-pressed', String(control.dataset.mode === mode));
    });
  }

  private showNotebook(): void {
    if (this.labShell === null && this.auxiliary !== null) {
      this.auxiliary.dispose();
      this.auxiliary = null;
    }
    this.panel.removeClass('cascaqit-Presentation');
    this.app.shell.activateById(this.panel.id);
    this.labShell?.collapseLeft();
    this.markMode('Notebook');
    this.panel.content.update();
  }

  private async openEditor(kind: 'digital' | 'analog'): Promise<void> {
    this.showNotebook();
    await this.app.commands.execute(`cascaqit:open-${kind}-editor`);
    this.markMode(kind === 'digital' ? 'Digital' : 'Analog');
  }

  private togglePresentation(): void {
    const enable = !this.panel.hasClass('cascaqit-Presentation');
    this.showNotebook();
    if (enable) {
      this.panel.addClass('cascaqit-Presentation');
      this.markMode('演示');
    }
    this.panel.content.update();
  }

  private view(title: string): Widget {
    this.auxiliary?.dispose();
    const dialog = this.labShell === null ? document.createElement('dialog') : null;
    const widget = dialog === null ? new Widget() : new Widget({ node: dialog });
    widget.id = `cascaqit-workbench-${this.panel.id}`;
    widget.title.label = `${title} · ${this.panel.context.path.split('/').pop()}`;
    widget.title.closable = true;
    widget.addClass('cascaqit-Workbench');
    widget.addClass('cascaqit-Workbench-detail');
    const heading = node('header', 'cascaqit-Workbench-detailHeader');
    heading.append(node('h2', '', title), button('返回 Notebook', () => this.showNotebook()));
    widget.node.append(heading);
    if (dialog !== null) {
      dialog.classList.add('cascaqit-Workbench-dialog');
      dialog.setAttribute('aria-label', title);
      dialog.addEventListener('cancel', () => this.showNotebook());
      Widget.attach(widget, document.body);
      dialog.showModal();
    } else {
      this.app.shell.add(widget, 'main', { mode: 'tab-after', ref: this.panel.id });
      this.app.shell.activateById(widget.id);
    }
    this.labShell?.collapseLeft();
    this.auxiliary = widget;
    return widget;
  }

  private async showCode(): Promise<void> {
    const view = this.view('Code · 浏览器开发环境');
    const intro = node('p', '', '在独立标签页编辑同一项目，使用文件搜索、终端和扩展。');
    view.node.append(intro, node('p', 'cascaqit-Workbench-hint',
      '打开前将保存当前 Notebook。两边共享文件，但不自动共享内核变量；请避免同时编辑同一个文件。'));
    const state = node('p', '', '正在检查开发环境…');
    state.setAttribute('role', 'status');
    view.node.append(state);
    this.markMode('Code');
    try {
      const capabilities = record(await workbenchRequest('workbench'));
      if (view.isDisposed) { return; }
      if (capabilities.code_available !== true) {
        state.textContent = 'Code 服务未安装或未启用。Notebook 和线路编辑可继续使用。';
        view.node.append(node('pre', '',
          'python -m pip install "cascaqit-jupyter[ide]"\n' +
          '# 安装 code-server 后，配置 CASCAQIT_CODE_SERVER 并重启 Jupyter'));
        const docs = node('a', '', '查看 code-server 安装说明');
        docs.href = 'https://coder.com/docs/code-server/install';
        docs.target = '_blank';
        docs.rel = 'noopener noreferrer';
        view.node.append(docs);
        return;
      }
      state.textContent = 'Code 已就绪 · 与 Jupyter 共享项目目录';
      const open = button('保存并打开 VS Code', async () => {
        // Reserve a tab synchronously, before saving, to avoid popup blocking.
        const target = window.open('about:blank', '_blank');
        if (target === null) {
          state.textContent = '浏览器阻止了新标签页，请允许弹出窗口后重试。';
          return;
        }
        target.opener = null;
        try {
          await this.panel.context.save();
          const root = String(capabilities.root);
          const url = new URL(URLExt.join(settings.baseUrl, 'code/'), window.location.origin);
          url.searchParams.set('folder', root);
          target.location.href = url.href;
        } catch (error) {
          target.close();
          state.textContent = `保存失败，未打开 Code：${String(error)}`;
        }
      });
      open.classList.add('is-primary');
      view.node.append(open);
    } catch (error) {
      state.textContent = String(error);
    }
  }

  private showResults(): void {
    const view = this.view('实验结果');
    this.markMode('结果');
    view.node.append(node('p', 'cascaqit-Workbench-hint',
      '输出与运行记录均为快照。修改程序后需重新运行；刷新页面后只保留 Notebook 已保存的输出和任务标识。'));
    view.node.append(button('刷新结果', () => this.showResults()));
    let count = 0;
    const cells = Array.from(this.panel.model?.cells ?? []);
    for (const run of workbenchRuns(this.panel)) {
      const cell = cells.find(value => value.id === run.cellId);
      const meta = record(record(cell?.getMetadata('cascaqit_jupyter')).editor_document);
      const stale = run.stale || cell === undefined || cell.sharedModel.getSource() !== run.source ||
        meta.revision !== run.revision || meta.compile_status === 'draft';
      const card = node('section', 'cascaqit-Workbench-result');
      card.append(node('h3', '', `${run.kind.toUpperCase()} · ${run.view.state} · ${run.time}`));
      card.append(node('p', 'cascaqit-Workbench-hint',
        `${stale ? '程序已修改 · 历史结果' : '运行快照'} · ${run.view.jobId}`));
      if (run.view.resultMime !== null) {
        const output = node('div');
        renderPayload(output, `${MIME_PREFIX}result+json`, run.view.resultMime);
        card.append(output);
      } else { card.append(node('p', '', run.view.message)); }
      view.node.append(card);
      count++;
    }
    for (const [index, cell] of cells.entries()) {
      const metadata = record(record(cell.getMetadata('cascaqit_jupyter')).editor_document);
      const lastJob = record(record(metadata.metadata).last_job);
      if (typeof lastJob.job_id === 'string' &&
          !workbenchRuns(this.panel).some(run => run.view.jobId === lastJob.job_id)) {
        view.node.append(node('p', 'cascaqit-Workbench-hint',
          `已保存任务 · ${String(lastJob.state)} · ${lastJob.job_id}（非实时状态）`));
        count++;
      }
      const data = record(cell.toJSON());
      for (const output of Array.isArray(data.outputs) ? data.outputs : []) {
        const bundle = record(record(output).data);
        for (const [mime, payload] of Object.entries(bundle)) {
          if (!mime.startsWith(MIME_PREFIX)) { continue; }
          const card = node('section', 'cascaqit-Workbench-result');
          card.append(button(`单元格 ${index + 1} · 返回源码`, () => {
            this.showNotebook();
            this.panel.content.activeCellIndex = index;
            void this.panel.content.scrollToItem(index);
          }));
          const rendered = node('div');
          renderPayload(rendered, mime, payload);
          card.append(rendered);
          view.node.append(card);
          count++;
        }
      }
    }
    if (count === 0) {
      view.node.append(node('div', 'cascaqit-Workbench-empty',
        '还没有实验结果。返回 Notebook 点击“运行全部”，或在线路编辑器中执行一次本地模拟。'));
    }
  }

  private dispose(): void {
    this.resizeObserver.disconnect();
    this.auxiliary?.dispose();
    this.panel.sessionContext.statusChanged.disconnect(this.updateStatus, this);
    this.panel.sessionContext.connectionStatusChanged.disconnect(this.updateStatus, this);
    this.panel.sessionContext.kernelChanged.disconnect(this.updateStatus, this);
  }

  private header = new Widget();
  private resizeObserver: ResizeObserver;
  private status = node('span', 'cascaqit-Workbench-status');
  private feedback = node('p', 'cascaqit-Workbench-feedback');
  private run: HTMLButtonElement;
  private auxiliary: Widget | null = null;
}

const workbenchPlugin: JupyterFrontEndPlugin<void> = {
  id: '@cascaqit/jupyter:workbench',
  autoStart: true,
  requires: [INotebookTracker, IDocumentManager],
  optional: [ICommandPalette, ILauncher, ILabShell],
  activate: (app: JupyterFrontEnd, notebooks: INotebookTracker,
    documents: IDocumentManager, palette: ICommandPalette | null,
    launcher: ILauncher | null, labShell: ILabShell | null): void => {
    let home: Widget | null = null;
    const shellMode = new ShellMode(app, `cascaqit:simple:${settings.baseUrl}:${labShell ? 'lab' : 'notebook'}`);
    app.commands.addCommand('cascaqit:toggle-simple-mode', {
      label: 'CASCAQit: 简洁模式',
      isToggled: () => shellMode.enabled,
      execute: () => shellMode.toggle()
    });
    app.commands.addKeyBinding({
      command: 'cascaqit:toggle-simple-mode', keys: ['Alt Shift M'], selector: 'body'
    });
    palette?.addItem({ command: 'cascaqit:toggle-simple-mode', category: 'CASCAQit' });
    let refreshHome: (() => Promise<void>) | null = null;
    const attach = (panel: NotebookPanel): void => {
      new NotebookWorkspace(app, panel, labShell, shellMode);
    };
    notebooks.forEach(attach);
    notebooks.widgetAdded.connect((_sender, panel) => attach(panel));
    app.commands.addCommand(HOME, {
      label: 'CASCAQit: 量子工作台',
      execute: () => {
        if (labShell === null) {
          window.open(URLExt.join(settings.baseUrl, 'lab/workspaces',
            `cascaqit-home-${crypto.randomUUID()}`), '_blank', 'noopener,noreferrer');
          return;
        }
        if (home === null || home.isDisposed) {
          const created = createWorkbenchHome(app, documents, workbenchRequest, shellMode);
          home = created.widget;
          refreshHome = created.refresh;
          app.shell.add(home, 'main');
        }
        void refreshHome?.();
        app.shell.activateById(home.id);
        labShell?.collapseLeft();
        return home;
      }
    });
    palette?.addItem({ command: HOME, category: 'CASCAQit' });
    launcher?.add({ command: HOME, category: 'CASCAQit', rank: 0 });
    void app.restored.then(() => {
      // Respect restored documents and explicit file URLs.
      if (labShell && notebooks.size === 0 && !PageConfig.getOption('treePath') &&
          !Array.from(labShell.widgets('main')).some(widget => widget.id !== 'launcher')) {
        void app.commands.execute(HOME);
      }
    });
  }
};

export default workbenchPlugin;
