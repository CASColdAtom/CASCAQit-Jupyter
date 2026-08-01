// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest';

let renderPayload: typeof import('../src/renderer').renderPayload;

beforeAll(async () => {
  Object.defineProperty(globalThis, 'DragEvent', {
    configurable: true,
    value: class DragEvent extends Event {}
  });
  ({ renderPayload } = await import('../src/renderer'));
});

const PROGRAM_MIME = 'application/vnd.cascaqit.program+json';
const RESULT_MIME = 'application/vnd.cascaqit.result+json';
const DIAGNOSTICS_MIME = 'application/vnd.cascaqit.diagnostics+json';
const VISUALIZATION_MIME = 'application/vnd.cascaqit.visualization+json';
const HASH = 'a'.repeat(64);

function root(): HTMLDivElement {
  return document.createElement('div');
}

function payload(kind: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    protocol_version: '1.0',
    kind,
    source: { id: `source.${kind}`, hash: HASH },
    cascaqit_schema_version: '0.1',
    data
  };
}

describe('CASCAQit renderer', () => {
  it('renders a Digital circuit with stable wires, gates, and measurement', () => {
    const node = root();
    renderPayload(
      node,
      PROGRAM_MIME,
      payload('program', {
        schema_version: '0.1',
        program_type: 'digital',
        validation_mode: 'ir_only',
        circuit: {
          qubits: ['q0', 'q1', 'q2'],
          gates: [
            { name: 'h', targets: ['q0'] },
            { name: 'cx', targets: ['q0', 'q1'] },
            { name: 'ccx', targets: ['q0', 'q1', 'q2'] },
            { name: 'cz', targets: ['q1', 'q2'] }
          ],
          measurements: [{ targets: ['q0', 'q1', 'q2'], key: 'm' }]
        }
      })
    );

    const svg = node.querySelector<SVGSVGElement>('[data-testid="digital-circuit"]');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    expect(svg?.dataset.cascaqitNonempty).toBe('true');
    expect(node.textContent).toContain('q0');
    expect(node.querySelectorAll('[data-role="control"]')).toHaveLength(4);
    expect(node.querySelectorAll('[data-role="target"]')).toHaveLength(3);
    expect(node.querySelectorAll('.cascaqit-Svg-target')).toHaveLength(2);
    expect(node.querySelectorAll('.cascaqit-Svg-measure')).toHaveLength(3);
  });

  it('renders separate Analog register and global waveform views', () => {
    const node = root();
    renderPayload(
      node,
      PROGRAM_MIME,
      payload('program', {
        schema_version: '0.1',
        program_type: 'analog',
        lifecycle_state: 'draft',
        register: {
          coordinate_unit: 'um',
          sites: [
            { site_id: 'q0', position: [0, 0], status: 'filled' },
            { site_id: 'q1', position: [5, 0], status: 'filled' }
          ]
        },
        hamiltonian: {
          terms: {
            rabi: { times: [0, 1], values: [0, 2], value_unit: 'rad/us' },
            detuning: {
              times: [0, 0.5, 1],
              values: [-4, 0, 4],
              value_unit: 'rad/us'
            },
            phase: 0
          }
        }
      })
    );

    expect(node.querySelectorAll('.cascaqit-Svg-siteFilled')).toHaveLength(2);
    expect(node.querySelectorAll('.cascaqit-Svg-wave')).toHaveLength(3);
    expect(node.querySelector('[data-testid="register-plot"]')).not.toBeNull();
    expect(node.querySelector('[data-testid="pulse-plot"]')).not.toBeNull();
  });

  it('renders constant controls and a waveform-valued Analog phase', () => {
    const node = root();
    renderPayload(
      node,
      PROGRAM_MIME,
      payload('program', {
        schema_version: '0.1',
        program_type: 'analog',
        register: {
          coordinate_unit: 'um',
          sites: [{ site_id: 'q0', position: [0, 0], status: 'filled' }]
        },
        hamiltonian: {
          terms: {
            rabi: { duration: 1, times: null, values: [2], value_unit: 'rad/us' },
            detuning: { duration: 1, times: null, values: [-1], value_unit: 'rad/us' },
            phase: {
              times: [0, 1],
              values: [0, 0.5],
              value_unit: 'rad'
            }
          }
        }
      })
    );

    expect(node.querySelectorAll('.cascaqit-Svg-wave')).toHaveLength(3);
    expect(node.textContent).toContain('phase');
  });

  it('renders counts with non-zero bars and visible bit ordering', () => {
    const node = root();
    renderPayload(
      node,
      RESULT_MIME,
      payload('result', {
        schema_version: '0.1',
        result_id: 'result.local.bell',
        program_hash: HASH,
        shots: 16,
        target_id: 'local.digital_simulator',
        counts: { '00': 6, '11': 10 },
        probabilities: { '00': 0.375, '11': 0.625 },
        observables: { pauli_z: { 'z:q0': 0, 'z:q1': 0 } },
        bit_ordering: { convention: 'digital_qubit_order', qubits: 'q0,q1' },
        metadata: {
          seed: 2026,
          backend_id: 'local.simulator',
          network_accessed: false,
          offline_deterministic: true,
          execution_package_created: false,
          simulation_resource_estimate: {
            method: 'state_vector',
            logical_sites: 2,
            hilbert_dimension: 4,
            estimated_peak_bytes: 8576
          },
          simulation_resource_usage: {
            actual_peak_rss_bytes: 1048576,
            incremental_peak_rss_bytes: 4096,
            wall_time_seconds: 0.0123,
            measurement_scope: 'job'
          }
        },
        diagnostics: []
      })
    );

    const bars = Array.from(node.querySelectorAll<SVGRectElement>('.cascaqit-Svg-bar'));
    expect(bars).toHaveLength(2);
    expect(bars.every(bar => Number(bar.getAttribute('height')) > 0)).toBe(true);
    expect(node.textContent).toContain('digital_qubit_order | q0,q1');
    expect(node.textContent).toContain('16 shots');
    expect(node.textContent).toContain('result.local.bell');
    expect(node.textContent).toContain('Probabilities');
    expect(node.textContent).toContain('62.5%');
    expect(node.textContent).toContain('Observables');
    expect(node.textContent).toContain('pauli_z / z:q0');
    expect(node.textContent).toContain('Execution boundary');
    expect(node.textContent).toContain('Offline deterministic');
    expect(node.textContent).toContain('Simulation resources');
    expect(node.textContent).toContain('8.38 KiB');
    expect(node.textContent).toContain('1.00 MiB');
  });

  it('renders Visualization IR by visualization kind', () => {
    const node = root();
    renderPayload(
      node,
      VISUALIZATION_MIME,
      payload('visualization', {
        spec: { visualization_kind: 'register', title: 'Target register' },
        coordinate_unit: 'um',
        sites: [
          { site_id: 'a0', x: 0, y: 0, filled: true },
          { site_id: 'a1', x: 4, y: 2, filled: false }
        ]
      })
    );

    expect(node.textContent).toContain('Target register');
    expect(node.querySelectorAll('.cascaqit-Svg-siteFilled')).toHaveLength(1);
    expect(node.querySelectorAll('.cascaqit-Svg-siteVacant')).toHaveLength(1);
  });

  it('routes counts and pulse Visualization IR to domain plots', () => {
    const counts = root();
    renderPayload(
      counts,
      VISUALIZATION_MIME,
      payload('visualization', {
        spec: { visualization_kind: 'counts_histogram', title: 'Counts' },
        shots: 8,
        bars: [
          { bitstring: '00', count: 5 },
          { bitstring: '11', count: 3 }
        ]
      })
    );
    expect(counts.querySelectorAll('.cascaqit-Svg-bar')).toHaveLength(2);

    const pulse = root();
    renderPayload(
      pulse,
      VISUALIZATION_MIME,
      payload('visualization', {
        spec: { visualization_kind: 'pulse_timeline', title: 'Pulse' },
        time_unit: 'us',
        channels: [
          {
            channel_id: 'rabi',
            value_unit: 'rad/us',
            points: [
              { time: 0, value: 0 },
              { time: 1, value: 2 }
            ]
          }
        ]
      })
    );
    expect(pulse.querySelectorAll('.cascaqit-Svg-wave')).toHaveLength(1);
  });

  it('labels Hybrid Visualization IR as a plan-only timeline', () => {
    const node = root();
    renderPayload(
      node,
      VISUALIZATION_MIME,
      payload('visualization', {
        spec: { visualization_kind: 'hybrid_timeline', title: 'Hybrid plan' },
        plan_only: true,
        blocks: [
          { block_id: 'prepare', program_kind: 'digital' },
          { block_id: 'evolve', program_kind: 'analog' }
        ]
      })
    );

    expect(node.querySelectorAll('.cascaqit-HybridBlock')).toHaveLength(2);
    expect(node.textContent).toContain('Plan only');
  });

  it('treats diagnostic markup as text and keeps non-color severity labels', () => {
    const node = root();
    const hostile = '<img src=x onerror=alert(1)><script>alert(2)</script>';
    renderPayload(
      node,
      DIAGNOSTICS_MIME,
      payload('diagnostics', {
        items: [
          {
            severity: 'error',
            code: 'TEST_INVALID',
            object_path: 'circuit.gates[0]',
            message: hostile,
            suggestion: 'Replace the unsupported gate.'
          }
        ]
      })
    );

    expect(node.querySelector('img')).toBeNull();
    expect(node.querySelector('script')).toBeNull();
    expect(node.textContent).toContain(hostile);
    expect(node.textContent).toContain('Error');
    expect(node.textContent).toContain('TEST_INVALID');
  });

  it('shows a bounded error for an invalid payload', () => {
    const node = root();
    renderPayload(node, PROGRAM_MIME, { kind: 'program' });
    expect(node.querySelector('[role="alert"]')?.textContent).toBe(
      'Invalid CASCAQit MIME payload'
    );

    renderPayload(node, RESULT_MIME, payload('program', {}));
    expect(node.querySelector('[role="alert"]')?.textContent).toBe(
      'Invalid CASCAQit MIME payload'
    );
  });
});
