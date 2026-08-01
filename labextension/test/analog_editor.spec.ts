// @vitest-environment jsdom

import type { NotebookPanel } from '@jupyterlab/notebook';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@jupyterlab/notebook', () => ({
  NotebookActions: {
    insertBelow: vi.fn(),
    changeCellType: vi.fn()
  }
}));

vi.mock('../src/bokeh_waveform', () => ({
  renderBokehWaveforms: vi.fn(async (target: HTMLElement) => {
    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'mock-bokeh-canvas';
    target.dataset.cascaqitBokehNonempty = 'true';
    target.append(canvas);
    return [];
  })
}));

let AnalogEditorWidget: typeof import('../src/analog_editor').AnalogEditorWidget;

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
  ({ AnalogEditorWidget } = await import('../src/analog_editor'));
});

describe('AnalogEditorWidget', () => {
  it('provides register, waveform, measurement, and non-empty previews', () => {
    const editor = new AnalogEditorWidget({
      panel: () => null,
      documentId: () => 'document.analog.test'
    });
    document.body.append(editor.node);

    expect(editor.node.getElementsByTagName('input').length).toBeGreaterThan(15);
    expect(editor.node.textContent).toContain('Rabi waveform');
    expect(editor.node.textContent).toContain('Detuning waveform');
    expect(editor.node.textContent).toContain('Phase waveform');
    expect(
      editor.node.querySelector('[data-testid="analog-register-preview"] svg')
    ).not.toBeNull();
    expect(
      editor.node.querySelector('[data-testid="analog-waveform-preview"]')
    ).not.toBeNull();
    expect(editor.node.textContent).toContain('Array layout');
  });

  it('applies a parameterized register layout through labeled controls', () => {
    const editor = new AnalogEditorWidget({
      panel: () => null,
      documentId: () => 'document.analog.test'
    });
    document.body.append(editor.node);

    const shape = editor.node.querySelector<HTMLSelectElement>(
      'select[aria-label="Register shape"]'
    )!;
    shape.value = 'rectangle';
    shape.dispatchEvent(new Event('change'));
    const rows = editor.node.querySelector<HTMLInputElement>(
      'input[aria-label="Rows"]'
    )!;
    const columns = editor.node.querySelector<HTMLInputElement>(
      'input[aria-label="Columns"]'
    )!;
    rows.value = '3';
    rows.dispatchEvent(new Event('change'));
    columns.value = '4';
    columns.dispatchEvent(new Event('change'));
    editor.node.querySelector<HTMLButtonElement>(
      'button[aria-label="Apply atom register layout"]'
    )!.click();

    expect(editor.editorDocument.editor_model.register.sites).toHaveLength(12);
    expect(editor.editorDocument.editor_model.register.layout_tool).toMatchObject({
      shape: 'rectangle',
      rows: 3,
      columns: 4
    });
  });

  it('edits sites and segments through keyboard-operable controls', () => {
    const editor = new AnalogEditorWidget({
      panel: () => null,
      documentId: () => 'document.analog.test'
    });
    document.body.append(editor.node);

    editor.node.querySelector<HTMLButtonElement>(
      'button[aria-label="Add register site"]'
    )?.click();
    editor.node.querySelector<HTMLButtonElement>(
      'button[aria-label="Add phase waveform segment"]'
    )?.click();

    expect(editor.editorDocument.editor_model.register.sites).toHaveLength(3);
    expect(editor.editorDocument.editor_model.controls.phase.segments).toHaveLength(2);
    expect(
      Array.from(editor.node.querySelectorAll('button, input')).every(
        control => control.getAttribute('tabindex') !== '-1'
      )
    ).toBe(true);
  });

  it('keeps an added site when a layout is selected and applied again', () => {
    const editor = new AnalogEditorWidget({
      panel: () => null,
      documentId: () => 'document.analog.test'
    });
    document.body.append(editor.node);

    editor.node.querySelector<HTMLButtonElement>(
      'button[aria-label="Add register site"]'
    )!.click();
    const added = editor.editorDocument.editor_model.register.sites[2];

    const shape = editor.node.querySelector<HTMLSelectElement>(
      'select[aria-label="Register shape"]'
    )!;
    shape.value = 'line';
    shape.dispatchEvent(new Event('change'));
    editor.node.querySelector<HTMLButtonElement>(
      'button[aria-label="Apply atom register layout"]'
    )!.click();

    expect(editor.editorDocument.editor_model.register.sites).toHaveLength(3);
    expect(editor.editorDocument.editor_model.register.sites[2]).toMatchObject({
      id: added.id,
      occupied: added.occupied
    });
  });

  it('waits for notebook content before restoring Analog metadata', async () => {
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>(resolve => {
      markReady = resolve;
    });
    const panel = { context: { ready } } as unknown as NotebookPanel;
    const restored = {
      ...new AnalogEditorWidget({
        panel: () => null,
        documentId: () => 'document.analog.restored'
      }).editorDocument,
      generated_cell_id: 'cell-analog',
      compile_status: 'ready' as const
    };
    const bridge = {
      restoreAnalog: vi.fn(() => restored)
    } as any;
    const editor = new AnalogEditorWidget({ panel: () => panel, bridge });

    const binding = editor.bindPanel(panel);
    expect(bridge.restoreAnalog).not.toHaveBeenCalled();
    markReady();
    await binding;

    expect(editor.editorDocument).toEqual(restored);
    expect(editor.node.textContent).toContain('Restored from generated cell metadata');
  });
});
