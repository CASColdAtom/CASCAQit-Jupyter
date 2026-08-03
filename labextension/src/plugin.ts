import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ICommandPalette, ToolbarButton } from '@jupyterlab/apputils';
import {
  completerWidgetIcon,
  ICompletionProviderManager
} from '@jupyterlab/completer';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { MessageLoop } from '@lumino/messaging';
import { SplitPanel, Widget } from '@lumino/widgets';

import '../labextension/style/index.css';
import { AnalogEditorWidget } from './analog_editor';
import {
  CodeCompletionController,
  installCodeCompletionAutoInvoke,
  invokeCodeCompletion,
  isCodeCellEditing
} from './code_completion';
import { DigitalEditorWidget } from './digital_editor';

const DIGITAL_COMMAND = 'cascaqit:open-digital-editor';
const ANALOG_COMMAND = 'cascaqit:open-analog-editor';
const TOGGLE_COMPLETION_COMMAND = 'cascaqit:toggle-code-autocompletion';
const INVOKE_COMPLETION_COMMAND = 'cascaqit:invoke-code-completion';

const plugin: JupyterFrontEndPlugin<void> = {
  id: '@cascaqit/jupyter:digital-editor',
  autoStart: true,
  requires: [INotebookTracker, ISettingRegistry, ICompletionProviderManager],
  optional: [ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    notebooks: INotebookTracker,
    settingRegistry: ISettingRegistry,
    completionManager: ICompletionProviderManager,
    palette: ICommandPalette | null
  ): void => {
    let digitalEditor: DigitalEditorWidget | null = null;
    let analogEditor: AnalogEditorWidget | null = null;
    const completion = new CodeCompletionController(settingRegistry);
    const addEditorToWorkspace = (
      editor: DigitalEditorWidget | AnalogEditorWidget,
      rank: number
    ): void => {
      app.shell.add(editor, 'left', { rank });
      editor.parent?.addClass('cascaqit-EditorHost');
    };
    const openDigital = async (): Promise<void> => {
      if (digitalEditor === null || digitalEditor.isDisposed) {
        digitalEditor = new DigitalEditorWidget({
          panel: () => notebooks.currentWidget
        });
        addEditorToWorkspace(digitalEditor, 900);
      }
      await digitalEditor.bindPanel(notebooks.currentWidget);
      app.shell.activateById(digitalEditor.id);
      enableEditorResize(digitalEditor);
    };
    const openAnalog = async (): Promise<void> => {
      if (analogEditor === null || analogEditor.isDisposed) {
        analogEditor = new AnalogEditorWidget({
          panel: () => notebooks.currentWidget
        });
        addEditorToWorkspace(analogEditor, 901);
      }
      await analogEditor.bindPanel(notebooks.currentWidget);
      app.shell.activateById(analogEditor.id);
      enableEditorResize(analogEditor);
    };

    app.commands.addCommand(DIGITAL_COMMAND, {
      label: 'CASCAQit: Open Digital Editor',
      caption: 'Open the CASCAQit visual Digital circuit editor',
      isEnabled: () => notebooks.currentWidget !== null,
      execute: openDigital
    });
    app.commands.addCommand(ANALOG_COMMAND, {
      label: 'CASCAQit: Open Analog Editor',
      caption: 'Open the CASCAQit atom register and waveform editor',
      isEnabled: () => notebooks.currentWidget !== null,
      execute: openAnalog
    });
    app.commands.addCommand(TOGGLE_COMPLETION_COMMAND, {
      label: () =>
        `CASCAQit: ${completion.enabled ? 'Disable' : 'Enable'} Code Autocompletion`,
      caption: 'Toggle automatic suggestions while editing notebook Code Cells',
      icon: completerWidgetIcon,
      isEnabled: () => completion.initialized,
      isToggled: () => completion.enabled,
      execute: async () => {
        await completion.toggle();
      }
    });
    app.commands.addCommand(INVOKE_COMPLETION_COMMAND, {
      label: 'CASCAQit: Invoke Code Completion',
      caption: 'Show completion suggestions for the active notebook Code Cell',
      icon: completerWidgetIcon,
      isEnabled: () => isCodeCellEditing(notebooks.currentWidget),
      execute: () => invokeCodeCompletion(notebooks.currentWidget, completionManager)
    });
    app.commands.addKeyBinding({
      command: DIGITAL_COMMAND,
      keys: ['Alt Shift Q'],
      selector: '.jp-Notebook'
    });
    app.commands.addKeyBinding({
      command: ANALOG_COMMAND,
      keys: ['Alt Shift A'],
      selector: '.jp-Notebook'
    });
    app.commands.addKeyBinding({
      command: INVOKE_COMPLETION_COMMAND,
      keys: ['Ctrl Space'],
      selector: '.jp-Notebook.jp-mod-editMode .jp-CodeCell .cm-content'
    });
    palette?.addItem({ command: DIGITAL_COMMAND, category: 'CASCAQit' });
    palette?.addItem({ command: ANALOG_COMMAND, category: 'CASCAQit' });
    palette?.addItem({ command: TOGGLE_COMPLETION_COMMAND, category: 'CASCAQit' });
    palette?.addItem({ command: INVOKE_COMPLETION_COMMAND, category: 'CASCAQit' });

    const completionButtons = new Set<ToolbarButton>();
    completion.changed.connect(() => {
      completionButtons.forEach(button => {
        button.enabled = completion.initialized;
        button.pressed = completion.enabled;
      });
      app.commands.notifyCommandChanged(TOGGLE_COMPLETION_COMMAND);
    });

    const addToolbarButton = (panel: NotebookPanel): void => {
      panel.toolbar.insertItem(
        10,
        'cascaqitDigitalEditor',
        new ToolbarButton({
          label: 'Digital',
          tooltip: 'Open CASCAQit Digital Editor',
          onClick: () => void openDigital()
        })
      );
      panel.toolbar.insertItem(
        11,
        'cascaqitAnalogEditor',
        new ToolbarButton({
          label: 'Analog',
          tooltip: 'Open CASCAQit Analog Editor',
          onClick: () => void openAnalog()
        })
      );
      const completionButton = new ToolbarButton({
        icon: completerWidgetIcon,
        tooltip: 'Enable automatic Code Cell completion',
        pressedTooltip: 'Disable automatic Code Cell completion',
        pressed: completion.enabled,
        enabled: completion.initialized,
        dataset: { testid: 'toggle-code-autocompletion' },
        onClick: () => void app.commands.execute(TOGGLE_COMPLETION_COMMAND)
      });
      panel.toolbar.insertItem(
        12,
        'cascaqitCodeAutocompletion',
        completionButton
      );
      completionButtons.add(completionButton);
      panel.disposed.connect(() => completionButtons.delete(completionButton));
    };
    notebooks.forEach(addToolbarButton);
    notebooks.widgetAdded.connect((_sender, panel) => addToolbarButton(panel));
    installCodeCompletionAutoInvoke(notebooks, completion, completionManager);

    void app.restored
      .then(() => completion.initialize())
      .catch(error => {
        console.error('Failed to initialize Code Cell autocompletion.', error);
      });
  }
};

function enableEditorResize(editor: DigitalEditorWidget | AnalogEditorWidget): void {
  if (editor.hasClass('is-resize-pending') || editor.hasClass('is-resizable')) {
    return;
  }
  editor.parent?.addClass('cascaqit-EditorHost');
  editor.addClass('is-resize-pending');
  setTimeout(() => {
    if (!editor.isDisposed) {
      const host = editorResizeHost(editor);
      const splitSizes = host === null
        ? null
        : host.widgets.map(widget => widget.node.getBoundingClientRect().width);
      editor.addClass('is-resizable');
      if (editor.parent !== null) {
        MessageLoop.sendMessage(editor.parent, Widget.Msg.FitRequest);
        MessageLoop.sendMessage(editor.parent, Widget.Msg.UpdateRequest);
      }
      if (host !== null) {
        MessageLoop.sendMessage(host, Widget.Msg.FitRequest);
        MessageLoop.sendMessage(host, Widget.Msg.UpdateRequest);
      }
      requestAnimationFrame(() => {
        if (host !== null && splitSizes !== null) {
          host.setRelativeSizes(splitSizes);
        }
        requestAnimationFrame(() => {
          editor.removeClass('is-resize-pending');
          editor.addClass('is-resize-ready');
        });
      });
    }
  }, 300);
}

function editorResizeHost(editor: Widget): SplitPanel | null {
  let parent = editor.parent;
  let split: SplitPanel | null = null;
  while (parent !== null) {
    if (parent instanceof SplitPanel && parent.orientation === 'horizontal') {
      split = parent;
    }
    parent = parent.parent;
  }
  return split;
}

export default plugin;
