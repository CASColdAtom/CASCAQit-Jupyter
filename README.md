# CASCAQit Jupyter

CASCAQit-Jupyter 为 JupyterLab 4 和 Notebook 7 提供 CASCAQit 中性原子量子编程集成。当前版本包含可安装的 Python kernel companion（内核伴随包）、Digital 和 Analog 可视化编辑器，以及面向 CASCAQit Program、Result、Diagnostics 和 Visualization IR 公开对象的安全 MIME 渲染器。

## 安装

先安装 CASCAQit `>=1.0.5a,<1.1` 的已发布 wheel（Python 安装包），再克隆并安装本仓库：

```console
git clone https://github.com/CASColdAtom/CASCAQit-Jupyter.git
cd CASCAQit-Jupyter
npm ci
python -m pip install ".[lab,test]"
jupyter labextension list
```

检查结果中应包含已启用且状态为 `OK` 的 `@cascaqit/jupyter`。随后运行 JupyterLab：

```console
jupyter lab
```

## 显示程序和结果

在 Notebook 的当前 Python 内核中运行下面的代码，可以显示一个确定性的本地 Digital 程序、运行结果和计数直方图：

```python
from cascaqit import Circuit, build_counts_histogram
from cascaqit_jupyter import display_program, display_result, display_visualization
from IPython.display import display

circuit = Circuit(2, program_id="program.notebook.bell")
circuit.h(0).cx(0, 1).measure_all()
program = circuit.to_program()
result = circuit.run(shots=32, seed=2026, return_probabilities=True)

display(display_program(program))
display(display_result(result))
display(display_visualization(build_counts_histogram(result)))
```

[`examples/read_only_renderers.ipynb`](examples/read_only_renderers.ipynb) 包含当前全部只读视图的离线示例。渲染器只用受控的 DOM 和 SVG 元素显示版本化 JSON 数据；诊断信息中的 HTML 或 JavaScript 会作为文本显示，不会执行。

## 可视化编辑 Digital 程序

打开带有 Python 内核的 Notebook，在工具栏中选择 **Digital**。也可以在命令面板运行 `CASCAQit: Open Digital Editor`，或在 Notebook 获得焦点时按 `Alt+Shift+Q`。

编辑器支持增加和重命名量子比特、添加及调整量子门顺序、设置末端测量，然后用 **Generate cell** 生成普通的 CASCAQit Python 代码。当前支持 `H`、`X`、`Y`、`Z`、`RX`、`RY`、`RZ`、`CX`、`CZ` 和 `SWAP`；旋转参数必须是数值，生成前必须启用末端测量。[`examples/digital_editor.ipynb`](examples/digital_editor.ipynb) 可以直接用于体验编辑流程。

## 可视化编辑 Analog 程序

在工具栏选择 **Analog**，在命令面板运行 `CASCAQit: Open Analog Editor`，或按 `Alt+Shift+A`。编辑器支持二维全局原子寄存器、空位、分段线性的全局 Rabi、detuning 和 phase 控制，以及末端 ground/Rydberg 测量。

三个控制通道必须具有相同总时长，相邻分段必须连续。编译使用 CASCAQit 已发布的 `AtomRegister`、`Waveform`、`AHSProgram` 和离线 `MockNeutralAtomTarget` 公开 API。校验失败时，编辑器会保留 CASCAQit 的诊断代码、对象路径、消息和修改建议，并标记对应的寄存器、波形或测量控件。[`examples/analog_editor.ipynb`](examples/analog_editor.ipynb) 提供了一个两站点示例。

## 本地运行、保存和恢复

生成代码后，可在 **Local execution** 中设置 shots 和 seed，再选择 **Run**。编辑器通过当前内核中的公开 `LocalBackend` 运行程序，显示排队、运行和终态，支持协作式取消，并在面板内显示诊断和 Result。Analog 运行还会显示模拟时间步数。

Notebook metadata（元数据）会保存版本化编辑文档、生成代码的精确哈希、最近一次 Job 和 Result 的标识、运行选项、状态证据及执行边界。保存并重新打开 Notebook 后，可以恢复可视化编辑内容和历史任务标识。

如果用户修改了生成的 Python，编辑器会进入明确的 `Detached` 状态，保留用户代码并拒绝静默覆盖。再次运行前也会重新编译编辑文档并核对代码哈希。内核重启后，内存中的 Job 注册表会失效，Result 的完整数据不会仅凭 metadata 重建。

## 当前渲染能力

- Digital 线路、量子门、控制位、目标位和末端测量；
- Analog 原子寄存器以及全局 Rabi、detuning 和 phase 时间线；
- Result 的计数、概率、观测量、seed、程序和结果标识、目标、比特顺序、执行边界、资源估算与用量、执行诊断；
- 计数直方图、原子寄存器、脉冲时间线和仅规划的 Hybrid 时间线；
- 带严重程度文字、诊断代码、对象路径、消息和建议的 Diagnostics 视图。

## 当前限制

编辑器不会把任意 Python 反向解析为可视化画布。Analog 本地专用控制和 OpenQASM 导入导出尚未实现。Jupyter kernel 执行普通 Python 代码，不是不受信代码沙箱；取消是协作式操作，只能分别报告取消请求和 CASCAQit 返回的实际状态，不能保证立即中断正在进行的数值计算。

本项目只使用 CASCAQit 已发布的公开 API，不导入 `cascaqit._internal`，不依赖 `cascaqit-compat`、CASCAQit-Skills 或相邻源码目录，也不会复制模拟器代码、访问 CASCAQit Cloud 或连接真实硬件。
