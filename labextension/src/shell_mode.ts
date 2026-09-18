import type { JupyterFrontEnd } from '@jupyterlab/application';
import { Signal } from '@lumino/signaling';
import { Widget } from '@lumino/widgets';

const CHROME_IDS = new Set([
  'jp-top-panel', 'jp-menu-panel', 'jp-bottom-panel', 'menu-panel-wrapper', 'menu-panel'
]);

/** Hide shell widgets through Lumino so the main area reclaims their space. */
export class ShellMode {
  constructor(private app: JupyterFrontEnd, private storageKey: string) {
    this.restoreButton.textContent = '显示菜单';
    this.restoreButton.type = 'button';
    this.restoreButton.className = 'cascaqit-ShellRestore';
    this.restoreButton.setAttribute('aria-label', '显示 Jupyter 菜单');
    this.restoreButton.hidden = true;
    this.restoreButton.addEventListener('click', () => this.setEnabled(false));
    document.body.append(this.restoreButton);
    app.shell.disposed.connect(() => {
      this.setEnabled(false, false);
      this.restoreButton.remove();
      Signal.clearData(this);
    });
    void app.restored.then(() => {
      if (app.shell.isDisposed) { return; }
      try { this.setEnabled(localStorage.getItem(storageKey) === 'true', false); }
      catch { /* Storage may be disabled by browser policy. */ }
    });
  }

  get enabled(): boolean { return this.active; }

  toggle(): void { this.setEnabled(!this.active); }

  button(owner: Widget): HTMLButtonElement {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'cascaqit-Workbench-button';
    control.textContent = '简洁模式';
    control.dataset.testid = 'shell-simple-mode';
    const update = (): void => control.setAttribute('aria-pressed', String(this.active));
    update();
    control.addEventListener('click', () => this.toggle());
    this.changed.connect(update);
    owner.disposed.connect(() => this.changed.disconnect(update));
    return control;
  }

  private setEnabled(enabled: boolean, persist = true): void {
    if (enabled !== this.active) {
      if (enabled) {
        const visit = (widget: Widget): void => {
          if (CHROME_IDS.has(widget.id) && !widget.isHidden) {
            this.hidden.push(widget);
            widget.hide();
          }
          for (const child of widget.children()) { visit(child); }
        };
        visit(this.app.shell);
      } else {
        for (const widget of this.hidden) {
          if (!widget.isDisposed) { widget.show(); }
        }
        this.hidden = [];
      }
      this.active = enabled;
      const restoreHadFocus = document.activeElement === this.restoreButton;
      this.restoreButton.hidden = !enabled;
      this.app.shell.fit();
      this.changed.emit(enabled);
      if (restoreHadFocus) {
        document.querySelector<HTMLButtonElement>('[data-testid="shell-simple-mode"]')?.focus();
      }
    }
    if (persist) {
      try { localStorage.setItem(this.storageKey, String(enabled)); }
      catch { /* Toggling still works without persistent browser storage. */ }
    }
  }

  private active = false;
  private hidden: Widget[] = [];
  private restoreButton = document.createElement('button');
  private changed = new Signal<this, boolean>(this);
}
