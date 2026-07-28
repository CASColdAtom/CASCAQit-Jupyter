import { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ICommandPalette, ToolbarButton } from '@jupyterlab/apputils';
import { INotebookTracker, NotebookPanel } from '@jupyterlab/notebook';

import '../labextension/style/index.css';
import { DigitalEditorWidget } from './digital_editor';

const COMMAND = 'cascaqit:open-digital-editor';

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
    let editor: DigitalEditorWidget | null = null;
    const open = async (): Promise<void> => {
      if (editor === null || editor.isDisposed) {
        editor = new DigitalEditorWidget({ panel: () => notebooks.currentWidget });
        app.shell.add(editor, 'left', { rank: 900 });
      }
      await editor.bindPanel(notebooks.currentWidget);
      app.shell.activateById(editor.id);
    };

    app.commands.addCommand(COMMAND, {
      label: 'CASCAQit: Open Digital Editor',
      caption: 'Open the CASCAQit visual Digital circuit editor',
      isEnabled: () => notebooks.currentWidget !== null,
      execute: open
    });
    app.commands.addKeyBinding({
      command: COMMAND,
      keys: ['Alt Shift Q'],
      selector: '.jp-Notebook'
    });
    palette?.addItem({ command: COMMAND, category: 'CASCAQit' });

    const addToolbarButton = (panel: NotebookPanel): void => {
      panel.toolbar.insertItem(
        10,
        'cascaqitDigitalEditor',
        new ToolbarButton({
          label: 'CASCAQit',
          tooltip: 'Open CASCAQit Digital Editor',
          onClick: () => void open()
        })
      );
    };
    notebooks.forEach(addToolbarButton);
    notebooks.widgetAdded.connect((_sender, panel) => addToolbarButton(panel));
  }
};

export default plugin;
