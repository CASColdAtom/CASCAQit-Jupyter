# Phase 025：量子云视觉皮肤

## 目标

将 CASCAQit 的 JupyterLab/Notebook 7 可视化界面统一到
`quantum-cloud-web` 量子云控制台的视觉语言，同时不覆盖用户选择的
JupyterLab 外壳主题，也不改变 Program、EditorDocument 或 Job 行为。

## 参考基线

视觉基线直接取自量子云前端当前源码与工作台截图：

- `apps/console-web/src/shared/styles/app.css`；
- `apps/console-web/src/features/workbench/WorkbenchEditor.vue`；
- `apps/console-web/src/features/workbench/CircuitCanvas.vue`。

采用的核心令牌包括 `#165dff` 主色、`#1d2129` 正文、
`#626d7c/#86909c` 次级文字、`#e5e6eb` 边框、`#f7f8fa` 画布和
8px 卡片圆角。量子控制、测量、成功、警告和错误继续使用紫、红、绿、
橙等功能色，避免界面成为单一蓝色调。

## 实现

- 在 CASCAQit 编辑器与只读渲染器作用域内定义量子云语义令牌，不污染
  JupyterLab 全局样式。
- 统一标题栏、指标区、表单控件、操作按钮、状态标签、诊断信息、结果表格
  和空状态的颜色、间距、圆角与字重。
- Digital 线路中的普通门、控制门和测量门分别使用蓝、紫、红语义；Analog
  原子、坐标轴与三类波形使用与量子云一致的功能色。
- 保留可见焦点环、复选框强调色、非颜色状态文字和 reduced-motion 偏好。
- 保留现有容器查询、左右分栏、横向滚动与窄屏单列行为。
- 新增 Playwright 视觉契约，验证主色、正文色、表面色、指标底色和 8px
  渲染卡片圆角。

## 验证

- TypeScript 严格类型检查：通过。
- 前端单元测试：11 个文件、66 项通过。
- JupyterLab 预构建扩展与 Python wheel：构建通过。
- 首轮完整 Playwright：20 个场景中 16 项通过、2 项按配置跳过；Digital、
  Analog、只读渲染器在 JupyterLab/Notebook 7 与桌面/窄屏组合下全部通过。
- 相关场景复跑：12 项中 11 项通过；唯一失败为已有 Analog 窄屏测试对
  CodeMirror 的坐标点击被左侧编辑器遮挡，首轮相同场景已通过。
- 最终核心皮肤验收：Digital 编辑器与全部只读渲染器共 8 项通过，覆盖
  JupyterLab/Notebook 7 的桌面与窄屏组合。
- SVG/Canvas 非空检查通过；人工检查桌面与窄屏截图，未发现文字溢出、控件
  重叠、空白线路或裁切。

## 已知环境问题

完整套件的桌面 Job 生命周期用例在 `job_status` 请求上持续超时；独立复跑仍
可复现。Jupyter Server 同时记录内核 WebSocket `connection` 为空和
`last_activity` 为空的异常。该问题不在本 Phase 修改面内，样式相关场景与
普通 Digital/Analog Job 场景均已通过。

## 范围保护

保留并排除用户已有的 `examples/analog_editor.ipynb`、根目录两个 Untitled
Notebook 和 `examples/Untitled.ipynb`，不纳入本 Phase 提交。
