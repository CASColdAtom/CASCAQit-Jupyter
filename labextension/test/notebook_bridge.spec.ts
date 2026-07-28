// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { NotebookPanel } from '@jupyterlab/notebook';

import { createAnalogDocument } from '../src/analog_document';
import { createDigitalDocument } from '../src/digital_document';

vi.mock('@jupyterlab/notebook', () => ({
  NotebookActions: {
    insertBelow: vi.fn(),
    changeCellType: vi.fn()
  }
}));

let CELL_METADATA_KEY: typeof import('../src/notebook_bridge').CELL_METADATA_KEY;
let NotebookBridge: typeof import('../src/notebook_bridge').NotebookBridge;
let analogEditorDocumentFromMetadata: typeof import('../src/notebook_bridge').analogEditorDocumentFromMetadata;
let editorDocumentFromMetadata: typeof import('../src/notebook_bridge').editorDocumentFromMetadata;

beforeAll(async () => {
  Object.defineProperty(globalThis, 'DragEvent', {
    configurable: true,
    value: class DragEvent extends Event {}
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    })
  });
  ({
    CELL_METADATA_KEY,
    NotebookBridge,
    analogEditorDocumentFromMetadata,
    editorDocumentFromMetadata
  } = await import('../src/notebook_bridge'));
});

describe('generated cell metadata', () => {
  it('restores the complete versioned editor document after reopen', () => {
    const document = {
      ...createDigitalDocument(() => 'document.digital.test'),
      generated_cell_id: 'cell-1',
      generated_source_hash: 'a'.repeat(64),
      source_program_hash: 'b'.repeat(64),
      compile_status: 'ready' as const
    };
    const metadata = {
      schema_version: '1.0',
      document_id: document.document_id,
      document_revision: document.revision,
      generated_source_hash: document.generated_source_hash,
      generated_cell_id: document.generated_cell_id,
      source_program_hash: document.source_program_hash,
      editor_document: document
    };

    expect(editorDocumentFromMetadata(metadata)).toEqual(document);
    expect(CELL_METADATA_KEY).toBe('cascaqit_jupyter');
  });

  it('restores metadata from an off-screen model cell without a cell widget', () => {
    const document = createDigitalDocument(() => 'document.digital.offscreen');
    const metadata = {
      schema_version: '1.0',
      document_id: document.document_id,
      document_revision: document.revision,
      generated_source_hash: null,
      generated_cell_id: null,
      source_program_hash: null,
      editor_document: document
    };
    const offscreenCellModel = {
      getMetadata: vi.fn((key: string) =>
        key === CELL_METADATA_KEY ? metadata : undefined
      )
    };
    const panel = {
      model: { cells: [offscreenCellModel] },
      content: { widgets: [] }
    } as unknown as NotebookPanel;

    expect(new NotebookBridge().restore(panel)).toEqual(document);
    expect(offscreenCellModel.getMetadata).toHaveBeenCalledWith(
      CELL_METADATA_KEY
    );
  });

  it('rejects unknown metadata versions and malformed payloads', () => {
    expect(editorDocumentFromMetadata({ schema_version: '2.0' })).toBeNull();
    expect(editorDocumentFromMetadata('<script>bad</script>')).toBeNull();
  });

  it('restores Analog metadata without matching it as a Digital document', () => {
    const document = {
      ...createAnalogDocument(() => 'document.analog.test'),
      generated_cell_id: 'cell-analog',
      compile_status: 'ready' as const
    };
    const metadata = {
      schema_version: '1.0',
      document_id: document.document_id,
      editor_document: document
    };

    expect(analogEditorDocumentFromMetadata(metadata)).toEqual(document);
    expect(editorDocumentFromMetadata(metadata)).toBeNull();
  });
});
