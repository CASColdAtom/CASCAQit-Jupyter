// @vitest-environment jsdom

import type { ICompletionProviderManager } from '@jupyterlab/completer';
import type { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import type { ISettingRegistry } from '@jupyterlab/settingregistry';
import { Signal } from '@lumino/signaling';
import { describe, expect, it, vi } from 'vitest';

import {
  AUTO_COMPLETION_SETTING,
  CodeCompletionController,
  COMPLETER_SETTINGS_PLUGIN,
  invokeCodeCompletion,
  installCodeCompletionAutoInvoke,
  isCompletionTriggerInput,
  isCodeCellEditing
} from '../src/code_completion';

class MockSettings {
  constructor(userValue: boolean | undefined) {
    this._userValue = userValue;
    this._compositeValue = userValue ?? false;
  }

  readonly changed = new Signal<this, void>(this);

  get(key: string): { composite: boolean; user: boolean | undefined } {
    expect(key).toBe(AUTO_COMPLETION_SETTING);
    return { composite: this._compositeValue, user: this._userValue };
  }

  readonly set = vi.fn(async (key: string, value: boolean): Promise<void> => {
    expect(key).toBe(AUTO_COMPLETION_SETTING);
    this._userValue = value;
    this._compositeValue = value;
    this.changed.emit();
  });

  setExternally(value: boolean): void {
    this._userValue = value;
    this._compositeValue = value;
    this.changed.emit();
  }

  private _userValue: boolean | undefined;
  private _compositeValue: boolean;
}

function registryFor(settings: MockSettings): ISettingRegistry {
  return {
    load: vi.fn(async (plugin: string) => {
      expect(plugin).toBe(COMPLETER_SETTINGS_PLUGIN);
      return settings as unknown as ISettingRegistry.ISettings;
    })
  } as unknown as ISettingRegistry;
}

function panelFor(type: 'code' | 'markdown', mode: 'edit' | 'command'): NotebookPanel {
  return {
    id: 'notebook-panel-id',
    content: {
      mode,
      activeCell: { model: { type } }
    }
  } as unknown as NotebookPanel;
}

describe('CodeCompletionController', () => {
  it('enables continuous completion when the user has no explicit setting', async () => {
    const settings = new MockSettings(undefined);
    const controller = new CodeCompletionController(registryFor(settings));

    await controller.initialize();

    expect(settings.set).toHaveBeenCalledWith(AUTO_COMPLETION_SETTING, true);
    expect(controller.initialized).toBe(true);
    expect(controller.enabled).toBe(true);
  });

  it('preserves an explicit disabled user setting', async () => {
    const settings = new MockSettings(false);
    const controller = new CodeCompletionController(registryFor(settings));

    await controller.initialize();

    expect(settings.set).not.toHaveBeenCalled();
    expect(controller.initialized).toBe(true);
    expect(controller.enabled).toBe(false);
  });

  it('toggles and follows settings changed outside the extension', async () => {
    const settings = new MockSettings(true);
    const controller = new CodeCompletionController(registryFor(settings));
    const changed = vi.fn();
    controller.changed.connect((_sender, enabled) => changed(enabled));
    await controller.initialize();

    await controller.toggle();
    expect(controller.enabled).toBe(false);
    expect(changed).toHaveBeenLastCalledWith(false);

    settings.setExternally(true);
    expect(controller.enabled).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(true);
  });
});

describe('code completion invocation', () => {
  it('only classifies a single committed text character as automatic input', () => {
    expect(isCompletionTriggerInput(inputEvent('insertText', '.'))).toBe(true);
    expect(
      isCompletionTriggerInput(inputEvent('insertCompositionText', '中'))
    ).toBe(true);
    expect(
      isCompletionTriggerInput(inputEvent('insertCompositionText', '中', true))
    ).toBe(false);
    expect(isCompletionTriggerInput(inputEvent('insertText', 'Circuit'))).toBe(
      false
    );
    expect(isCompletionTriggerInput(inputEvent('insertFromPaste', 'x'))).toBe(
      false
    );
    expect(
      isCompletionTriggerInput(inputEvent('deleteContentBackward', null))
    ).toBe(false);
    expect(isCompletionTriggerInput(new Event('input'))).toBe(false);
  });

  it('only invokes the active notebook panel while editing a Code Cell', () => {
    const manager = { invoke: vi.fn() } as unknown as ICompletionProviderManager;
    const codePanel = panelFor('code', 'edit');

    expect(isCodeCellEditing(codePanel)).toBe(true);
    invokeCodeCompletion(codePanel, manager);
    invokeCodeCompletion(panelFor('markdown', 'edit'), manager);
    invokeCodeCompletion(panelFor('code', 'command'), manager);
    invokeCodeCompletion(null, manager);

    expect(manager.invoke).toHaveBeenCalledOnce();
    expect(manager.invoke).toHaveBeenCalledWith('notebook-panel-id');
  });

  it('debounces inserted Code Cell text into an automatic invocation', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="jp-Notebook jp-mod-editMode"><div class="jp-CodeCell"><div class="cm-content"></div></div></div>';
    document.body.append(host);
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const panel = panelFor('code', 'edit');
    Object.defineProperty(panel, 'node', { value: host });
    const notebooks = { currentWidget: panel } as unknown as INotebookTracker;
    const manager = { invoke: vi.fn() } as unknown as ICompletionProviderManager;
    const uninstall = installCodeCompletionAutoInvoke(
      notebooks,
      { enabled: true, initialized: true },
      manager,
      20
    );

    content.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        data: '.',
        inputType: 'insertText'
      })
    );
    await vi.advanceTimersByTimeAsync(19);
    expect(manager.invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(manager.invoke).toHaveBeenCalledWith('notebook-panel-id');

    uninstall();
    host.remove();
    vi.useRealTimers();
  });

  it('cancels a queued invocation after deletion or an active Cell change', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    host.innerHTML =
      '<div class="jp-Notebook jp-mod-editMode"><div class="jp-CodeCell"><div class="cm-content"></div></div></div>';
    document.body.append(host);
    const content = host.querySelector<HTMLElement>('.cm-content')!;
    const panel = panelFor('code', 'edit');
    Object.defineProperty(panel, 'node', { value: host });
    const notebooks = { currentWidget: panel } as unknown as INotebookTracker;
    const manager = { invoke: vi.fn() } as unknown as ICompletionProviderManager;
    const uninstall = installCodeCompletionAutoInvoke(
      notebooks,
      { enabled: true, initialized: true },
      manager,
      20
    );

    content.dispatchEvent(inputEvent('insertText', 'x'));
    content.dispatchEvent(inputEvent('deleteContentBackward', null));
    await vi.advanceTimersByTimeAsync(20);
    expect(manager.invoke).not.toHaveBeenCalled();

    content.dispatchEvent(inputEvent('insertText', 'y'));
    Object.defineProperty(panel.content, 'activeCell', {
      value: panelFor('code', 'edit').content.activeCell
    });
    await vi.advanceTimersByTimeAsync(20);
    expect(manager.invoke).not.toHaveBeenCalled();

    uninstall();
    host.remove();
    vi.useRealTimers();
  });
});

function inputEvent(
  inputType: string,
  data: string | null,
  isComposing = false
): InputEvent {
  return new InputEvent('input', {
    bubbles: true,
    data,
    inputType,
    isComposing
  });
}
