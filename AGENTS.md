# AGENTS.md

## CASCAQit-Jupyter Work Method

- 默认使用中文；专业英文术语首次出现时给出中文释义。
- `README.md` 只描述当前已经可用的用户能力；PRD、架构、scope plan 和阶段报告放在本地 `plan/`。
- 每个 Phase（阶段）开始前运行 `git status --short`，结束前运行适配检查、写阶段报告并提交。
- Python companion 与 JupyterLab prebuilt extension（预构建扩展）位于同一仓库并原子发布。
- 只使用已发布 CASCAQit 的公开 API；不使用相对源码路径、Git submodule、`cascaqit._internal`、旧项目或 `cascaqit-compat`。
- 不依赖 CASCAQit-Skills；共享语义直接来自 CASCAQit Program、Result、Diagnostics 和 Visualization 公开契约。
- 默认测试与 examples 保持 offline deterministic（离线确定性），不得访问凭证、云端或真实硬件。
- Visualization IR 是派生展示，不能用于修改或重建 ProgramIR；编辑状态由版本化 `EditorDocumentIR` 持有。
- 用户修改生成代码后进入 `detached` 状态，扩展不得静默覆盖。
- 前端使用严格 TypeScript、语义化 UI、键盘可操作和非颜色状态提示；完成前运行 Playwright 截图与非空渲染检查。
- Jupyter kernel 执行不是不受信代码沙箱；长任务取消按协作式 Job 语义描述。
