# 视频无限画布调研

调研日期：2026-10-23。通过 GitHub 官方仓库搜索 API、README 和依赖文件核对。

| 项目 | 与本项目相关的能力 | 技术与适用性 |
| --- | --- | --- |
| [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) | 无限画布、素材节点拖动缩放、连线、小地图、视频生成。 | React 19 + Zustand，MIT。适合参考素材编排交互。 |
| [HBAI-Ltd/Toonflow-app](https://github.com/HBAI-Ltd/Toonflow-app) | AI 视频、分镜、资产管理、无限画布和可视化工作流。 | Vue 3，MIT。完整制作平台，适合参考业务流程。 |
| [crisng95/flowboard](https://github.com/crisng95/flowboard) | 本地无限画布，以人物、产品、场景和视频节点组织生成流程。 | React + Zustand + `@xyflow/react`。README 标注 MIT，GitHub 搜索返回的 license 字段为空；实际复用源代码前应核实 LICENSE。依赖 Google Flow 登录与浏览器扩展。 |
| [SankaiAI/TwitCanva-Video-Workflow](https://github.com/SankaiAI/TwitCanva-Video-Workflow) | 图生视频、首尾帧、分镜、多模型节点连线与工作流保存。 | React + TypeScript + Vite，GitHub 元数据标注 Apache-2.0。适合参考图片到视频的节点交互。 |

## 本次实现

采用 MIT 的 `@xyflow/react` 构建交互，未复制上述应用源码。画布作为现有生视频工作区的另一种视图，复用同一套任务、首帧、提示词、批量生成、重试和保存逻辑。

- 默认保留列表视图，支持切换并记住偏好。
- 每次查看一个项目，节点可拖动，空白区域可平移，支持滚轮缩放、小地图和查看全部。
- 每个镜头拆成「图片 → 提示词 → 最终产物」三个节点并依次连线；一个镜头占一行，自上而下就是镜头顺序。
- 连线只表达链路关系，不参与生成调度；拖动布局不改变镜头编号和批次。
- 每个项目分别保存镜头位置和视口；提供自动排列，读取时跳过无效的存储数据。
- 进入批量删除时展示所有项目列表，沿用现有确认流程。
