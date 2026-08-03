import type { ICompletionProviderManager } from '@jupyterlab/completer';
import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import type { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Signal } from '@lumino/signaling';

export const COMPLETER_SETTINGS_PLUGIN =
  '@jupyterlab/completer-extension:manager';
export const AUTO_COMPLETION_SETTING = 'autoCompletion';

export class CodeCompletionController {
  constructor(private readonly registry: ISettingRegistry) {}

  get changed(): Signal<this, boolean> {
    return this._changed;
  }

  get enabled(): boolean {
    return this._enabled;
  }

  get initialized(): boolean {
    return this._initialized;
  }

  async initialize(): Promise<void> {
    if (this._settings !== null) {
      return;
    }
    this._settings = await this.registry.load(COMPLETER_SETTINGS_PLUGIN);
    const setting = this._settings.get(AUTO_COMPLETION_SETTING);
    if (setting.user === undefined) {
      await this._settings.set(AUTO_COMPLETION_SETTING, true);
    }
    this._settings.changed.connect(this._onSettingsChanged, this);
    this._initialized = true;
    this._syncEnabled(true);
  }

  async toggle(): Promise<void> {
    if (this._settings === null) {
      throw new Error('Code completion settings have not been initialized.');
    }
    await this._settings.set(AUTO_COMPLETION_SETTING, !this._enabled);
    this._syncEnabled();
  }

  private _onSettingsChanged(): void {
    this._syncEnabled();
  }

  private _syncEnabled(force = false): void {
    const enabled =
      this._settings?.get(AUTO_COMPLETION_SETTING).composite === true;
    if (force || enabled !== this._enabled) {
      this._enabled = enabled;
      this._changed.emit(enabled);
    }
  }

  private _enabled = false;
  private _initialized = false;
  private _settings: ISettingRegistry.ISettings | null = null;
  private readonly _changed = new Signal<this, boolean>(this);
}

export function isCodeCellEditing(panel: NotebookPanel | null): boolean {
  return (
    panel !== null &&
    panel.content.mode === 'edit' &&
    panel.content.activeCell?.model.type === 'code'
  );
}

export function invokeCodeCompletion(
  panel: NotebookPanel | null,
  manager: ICompletionProviderManager
): void {
  if (panel !== null && isCodeCellEditing(panel)) {
    manager.invoke(panel.id);
  }
}

export function installCodeCompletionAutoInvoke(
  notebooks: INotebookTracker,
  completion: Pick<CodeCompletionController, 'enabled' | 'initialized'>,
  manager: ICompletionProviderManager,
  delay = 180
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onInput = (event: Event): void => {
    const input = event as InputEvent;
    const target = event.target;
    const panel = notebooks.currentWidget;
    if (
      !completion.initialized ||
      !completion.enabled ||
      !(target instanceof Element) ||
      !input.inputType.startsWith('insert') ||
      input.isComposing ||
      input.data?.trim() === '' ||
      panel === null ||
      !panel.node.contains(target) ||
      target.closest('.jp-CodeCell .cm-content') === null ||
      !isCodeCellEditing(panel)
    ) {
      return;
    }

    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      if (
        completion.enabled &&
        notebooks.currentWidget === panel &&
        isCodeCellEditing(panel) &&
        document.querySelector('.jp-Completer:not(.lm-mod-hidden)') === null
      ) {
        manager.invoke(panel.id);
      }
    }, delay);
  };

  document.addEventListener('input', onInput, true);
  return () => {
    document.removeEventListener('input', onInput, true);
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}
