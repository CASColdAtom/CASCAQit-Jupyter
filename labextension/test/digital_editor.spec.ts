// @vitest-environment jsdom

import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { NotebookPanel } from '@jupyterlab/notebook';

import { createDigitalDocument } from '../src/digital_document';
import type { NotebookBridge } from '../src/notebook_bridge';

vi.mock('@jupyterlab/notebook', () => ({
  NotebookActions: {
    insertBelow: vi.fn(),
    changeCellType: vi.fn()
  }
}));

let DigitalEditorWidget: typeof import('../src/digital_editor').DigitalEditorWidget;

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
  ({ DigitalEditorWidget } = await import('../src/digital_editor'));
});

describe('DigitalEditorWidget', () => {
  it('provides keyboard-operable controls and a non-empty circuit preview', () => {
    const editor = new DigitalEditorWidget({
      panel: () => null,
      documentId: () => 'document.digital.test'
    });
    document.body.append(editor.node);

    const addGate = editor.node.querySelector<HTMLButtonElement>(
      'button[aria-label="Add gate"]'
    );
    addGate?.click();

    expect(editor.editorDocument.editor_model.gates).toHaveLength(1);
    expect(editor.node.querySelectorAll('button, input, select').length).toBeGreaterThan(8);
    expect(
      Array.from(editor.node.querySelectorAll('button, input, select')).every(
        control => !control.hasAttribute('tabindex') || control.getAttribute('tabindex') !== '-1'
      )
    ).toBe(true);
    const preview = editor.node.querySelector('[data-testid="editor-circuit-preview"] svg');
    expect(preview?.querySelectorAll('line, rect, text').length).toBeGreaterThan(4);
    expect(editor.node.textContent).not.toContain('<script>');
  });

  it('does not modify notebook state when no active kernel exists', async () => {
    const editor = new DigitalEditorWidget({
      panel: () => null,
      documentId: () => 'document.digital.test'
    });
    document.body.append(editor.node);

    editor.node.querySelector<HTMLButtonElement>('[data-testid="generate-cell"]')?.click();
    await Promise.resolve();

    expect(editor.node.textContent).toContain('Open a Notebook with a running Python kernel.');
    expect(editor.editorDocument.compile_status).toBe('draft');
  });

  it('waits for notebook content before restoring generated cell metadata', async () => {
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>(resolve => {
      markReady = resolve;
    });
    const restored = {
      ...createDigitalDocument(() => 'document.digital.restored'),
      generated_cell_id: 'cell-restored',
      compile_status: 'ready' as const
    };
    const bridge = {
      restore: vi.fn(() => restored)
    } as unknown as NotebookBridge;
    const panel = { context: { ready } } as unknown as NotebookPanel;
    const editor = new DigitalEditorWidget({
      panel: () => panel,
      bridge,
      documentId: () => 'document.digital.draft'
    });
    document.body.append(editor.node);

    const binding = editor.bindPanel(panel);
    expect(bridge.restore).not.toHaveBeenCalled();

    markReady();
    await binding;

    expect(bridge.restore).toHaveBeenCalledWith(panel);
    expect(editor.editorDocument).toEqual(restored);
    expect(editor.node.textContent).toContain(
      'Restored from generated cell metadata'
    );
  });
});
