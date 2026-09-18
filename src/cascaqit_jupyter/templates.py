"""Small, offline notebooks built from the same public editor compiler."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from cascaqit_jupyter.analog_compile import compile_analog_document
from cascaqit_jupyter.compile import compile_digital_document
from cascaqit_jupyter.editor_ir import EditorDocumentIR


def create_template(kind: str) -> dict[str, Any]:
    """Create an independent, editable Bell or two-atom experiment notebook."""
    if kind not in {"digital", "analog"}:
        raise ValueError("Unknown template")
    cell_id = str(uuid4())
    model: dict[str, Any]
    if kind == "digital":
        model = {
            "model_type": "digital",
            "qubits": [{"id": "q0"}, {"id": "q1"}],
            "gates": [
                {"id": "g0", "gate": "h", "targets": ["q0"], "parameters": {}},
                {
                    "id": "g1",
                    "gate": "cx",
                    "targets": ["q0", "q1"],
                    "parameters": {},
                },
            ],
            "measurement": {"terminal": True, "key": "m"},
        }
        title = "Bell 纠缠实验"
    else:
        model = {
            "model_type": "analog",
            "register": {
                "coordinate_unit": "um",
                "sites": [
                    {"id": "s0", "x": 0.0, "y": 0.0, "occupied": True},
                    {"id": "s1", "x": 5.0, "y": 0.0, "occupied": True},
                ],
            },
            "controls": {
                name: {
                    "segments": [
                        {
                            "id": f"{name}{index}",
                            "duration": duration,
                            "start_value": values[index],
                            "end_value": values[index + 1],
                        }
                        for index in range(len(values) - 1)
                    ]
                }
                for name, duration, values in [
                    ("rabi", 0.4, [0.0, 2.5, 2.5, 0.0]),
                    ("detuning", 0.4, [-4.0, -4.0, 4.0, 4.0]),
                    ("phase", 1.2, [0.0, 0.0]),
                ]
            },
            "measurement": {"enabled": True},
        }
        title = "双原子 Analog 实验"
    document = EditorDocumentIR.from_dict(
        {
            "schema_version": "1.0",
            "document_id": f"document.{uuid4()}",
            "revision": 0,
            "program_kind": kind,
            "editor_model": model,
            "generated_source_hash": None,
            "generated_cell_id": None,
            "compile_status": "draft",
            "source_program_hash": None,
            "metadata": {},
        }
    )
    compiled = (
        compile_digital_document(document, generated_cell_id=cell_id)
        if kind == "digital"
        else compile_analog_document(document, generated_cell_id=cell_id)
    )
    run = (
        "result = circuit.run(shots=shots, seed=seed, return_probabilities=True)"
        if kind == "digital"
        else "from cascaqit import LocalBackend\n"
        "result = LocalBackend(seed=seed, analog_time_steps=64).run(\n"
        "    program, shots=shots\n).result()"
    )
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "kernelspec": {
                "name": "python3",
                "display_name": "Python 3",
                "language": "python",
            },
            "language_info": {"name": "python"},
            "cascaqit_workbench": {"template": kind, "version": 1},
        },
        "cells": [
            {
                "id": str(uuid4()),
                "cell_type": "markdown",
                "metadata": {},
                "source": f"# {title}\n\n点击 **运行全部** 查看线路和结果。"
                "打开对应线路编辑器调整程序，或切换 **演示** 隐藏代码。\n\n"
                "本示例只执行本地模拟。修改参数后请重新运行相关单元格。",
            },
            {
                "id": cell_id,
                "cell_type": "code",
                "execution_count": None,
                "metadata": compiled.cell_metadata,
                "outputs": [],
                "source": compiled.generated_source,
            },
            {
                "id": str(uuid4()),
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": "from IPython.display import display\n"
                "from cascaqit_jupyter import display_program, display_result\n"
                "display(display_program(program))",
            },
            {
                "id": str(uuid4()),
                "cell_type": "code",
                "execution_count": None,
                "metadata": {},
                "outputs": [],
                "source": "shots = 128\nseed = 2026\n" + run + "\n"
                "display(display_result(result))",
            },
        ],
    }
