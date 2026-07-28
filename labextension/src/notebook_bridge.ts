import type { ICellModel } from '@jupyterlab/cells';
import { NotebookActions, NotebookPanel } from '@jupyterlab/notebook';

import {
  AnalogEditorDocument,
  restoreAnalogDocument
} from './analog_document';
import {
  DigitalEditorDocument,
  restoreDigitalDocument
} from './digital_document';

export const CELL_METADATA_KEY = 'cascaqit_jupyter';

export interface GeneratedCellContext {
  cellId: string | null;
  source: string | null;
}

export interface EditorDocumentIdentity {
  document_id: string;
  generated_cell_id: string | null;
}

export interface CompilePayload {
  document: unknown;
  generated_source: unknown;
  cell_metadata: unknown;
  detached: unknown;
  diagnostics: unknown;
}

export class NotebookBridge {
  restore(panel: NotebookPanel): DigitalEditorDocument | null {
    for (const cell of this.models(panel)) {
      const metadata = cell.getMetadata(CELL_METADATA_KEY);
      const restored = editorDocumentFromMetadata(metadata);
      if (restored !== null) {
        return restored;
      }
    }
    return null;
  }

  restoreAnalog(panel: NotebookPanel): AnalogEditorDocument | null {
    for (const cell of this.models(panel)) {
      const metadata = cell.getMetadata(CELL_METADATA_KEY);
      const restored = analogEditorDocumentFromMetadata(metadata);
      if (restored !== null) {
        return restored;
      }
    }
    return null;
  }

  context(
    panel: NotebookPanel,
    document: EditorDocumentIdentity
  ): GeneratedCellContext {
    const cell = this.findCell(panel, document);
    return cell === null
      ? { cellId: null, source: null }
      : {
          cellId: cell.id,
          source: cell.sharedModel.getSource()
        };
  }

  createGeneratedCell(panel: NotebookPanel): string {
    NotebookActions.insertBelow(panel.content);
    NotebookActions.changeCellType(panel.content, 'code');
    const cell = panel.content.activeCell;
    if (cell === null) {
      throw new Error('Jupyter did not create a generated code cell.');
    }
    return cell.model.id;
  }

  apply(
    panel: NotebookPanel,
    document: EditorDocumentIdentity,
    payload: CompilePayload
  ): void {
    if (payload.detached === true) {
      return;
    }
    if (typeof payload.generated_source !== 'string' || !isRecord(payload.cell_metadata)) {
      throw new Error('Kernel returned an incomplete Digital compilation.');
    }
    const cell = this.findCell(panel, document);
    if (cell === null) {
      throw new Error('Generated cell association was lost before synchronization.');
    }
    cell.sharedModel.setSource(payload.generated_source);
    const metadata = payload.cell_metadata[CELL_METADATA_KEY];
    if (!isRecord(metadata)) {
      throw new Error('Kernel returned invalid generated cell metadata.');
    }
    cell.setMetadata(CELL_METADATA_KEY, metadata);
  }

  private findCell(
    panel: NotebookPanel,
    document: EditorDocumentIdentity
  ): ICellModel | null {
    const cells = this.models(panel);
    if (document.generated_cell_id !== null) {
      const exact = cells.find(
        cell => cell.id === document.generated_cell_id
      );
      if (exact !== undefined) {
        return exact;
      }
    }
    return (
      cells.find(cell => {
        const metadata = cell.getMetadata(CELL_METADATA_KEY);
        return (
          isRecord(metadata) && metadata.document_id === document.document_id
        );
      }) ?? null
    );
  }

  private models(panel: NotebookPanel): ICellModel[] {
    return panel.model === null ? [] : Array.from(panel.model.cells);
  }
}

export function editorDocumentFromMetadata(
  value: unknown
): DigitalEditorDocument | null {
  if (!isRecord(value) || value.schema_version !== '1.0') {
    return null;
  }
  return restoreDigitalDocument(value.editor_document);
}

export function analogEditorDocumentFromMetadata(
  value: unknown
): AnalogEditorDocument | null {
  if (!isRecord(value) || value.schema_version !== '1.0') {
    return null;
  }
  return restoreAnalogDocument(value.editor_document);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
