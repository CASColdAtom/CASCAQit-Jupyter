import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ICommandPalette, ToolbarButton } from '@jupyterlab/apputils';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';
import { MessageLoop } from '@lumino/messaging';
import { SplitPanel, Widget } from '@lumino/widgets';

import '../labextension/style/index.css';
import { AnalogEditorWidget } from './analog_editor';
import { DigitalEditorWidget } from './digital_editor';

const DIGITAL_COMMAND = 'cascaqit:open-digital-editor';
const ANALOG_COMMAND = 'cascaqit:open-analog-editor';

const plugin: JupyterFrontEndPlugin<void> = {
  id: '@cascaqit/jupyter:digital-editor',
  autoStart: true,
  requires: [INotebookTracker],
  optional: [ICommandPalette],
  activate: (
    app: JupyterFrontEnd,
    notebooks: INotebookTracker,
    palette: ICommandPalette | null
  ): void => {
    let digitalEditor: DigitalEditorWidget | null = null;
    let analogEditor: AnalogEditorWidget | null = null;
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
    palette?.addItem({ command: DIGITAL_COMMAND, category: 'CASCAQit' });
    palette?.addItem({ command: ANALOG_COMMAND, category: 'CASCAQit' });

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
    };
    notebooks.forEach(addToolbarButton);
    notebooks.widgetAdded.connect((_sender, panel) => addToolbarButton(panel));
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
