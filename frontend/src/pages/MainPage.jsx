import SectionPanel from '../components/SectionPanel.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useAppHealth } from '../hooks/useAppHealth.js';
import { formatDateTime } from '../utils/formatDateTime.js';

const pipelineSteps = [
  '上传原视频并校验格式、大小与元数据',
  '调用 Gemini 完成整片剧情、角色、背景和时间锚点分析',
  '使用 FFmpeg 按时间锚点切分视频片段',
  '对片段做二次分析并生成可编辑提示词',
  '优化 @角色 标签并调用 Seed Dance 生成片段',
  '拼接所有片段并输出成片下载链接'
];

const initializationChecklist = [
  '前后端工程目录已拆分',
  '环境变量模板可直接复制为 .env',
  '后端日志与统一错误处理中间件已就位',
  '前端 Axios、Zustand、Tailwind CSS 已完成配置',
  'Git 工作流文档与基础 CI 已准备完成'
];

const nextMilestones = [
  '阶段 2：设计 MySQL Schema、Sequelize 模型与迁移脚本',
  '阶段 3：实现上传、分析、分割、生成、拼接 API',
  '阶段 4：搭建工作台 UI、片段卡片与状态流',
  '阶段 5：补齐集成测试、性能优化和安全加固'
];

const MainPage = () => {
  const { backendStatus, errorMessage, lastCheckedAt } = useAppHealth();

  return (
    <main className="dashboard-shell">
      <div className="mx-auto mb-6 flex max-w-7xl flex-col gap-4 rounded-[2rem] border border-white/70 bg-white/70 px-6 py-6 shadow-glow backdrop-blur md:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.34em] text-brand-700">
              Stage 1 Bootstrap
            </p>
            <h1 className="mt-3 max-w-3xl text-4xl font-black tracking-tight text-ink-900 md:text-5xl">
              AI 视频复刻工作台初始化完成，可直接进入后续功能开发。
            </h1>
            <p className="mt-4 max-w-3xl text-base leading-7 text-ink-700">
              当前页面作为启动骨架展示项目主链路、初始化成果和后续阶段目标。正式业务页面会在阶段 4
              进一步扩展为上传、分析、片段生成和拼接工作台。
            </p>
          </div>
          <div className="rounded-2xl bg-ink-900 px-5 py-4 text-white">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-white/80">后端健康状态</span>
              <StatusBadge status={backendStatus} />
            </div>
            <p className="mt-3 text-sm text-white/70">
              {errorMessage || '前端已接入 /health 健康检查，可用于开发期联调。'}
            </p>
            <p className="mt-2 text-xs text-white/50">
              最近检查：{lastCheckedAt ? formatDateTime(lastCheckedAt) : '尚未完成'}
            </p>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="space-y-6">
          <SectionPanel
            eyebrow="Project Flow"
            title="核心业务主流程"
            description="整套链路已经固化为统一实现基线，后续 API、数据库和前端状态流都会围绕这 6 个步骤展开。"
          >
            <ol className="space-y-3">
              {pipelineSteps.map((step, index) => (
                <li
                  key={step}
                  className="flex items-start gap-4 rounded-2xl bg-white/70 px-4 py-4"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white">
                    {index + 1}
                  </span>
                  <p className="pt-1 text-sm leading-6 text-ink-700">{step}</p>
                </li>
              ))}
            </ol>
          </SectionPanel>

          <SectionPanel
            eyebrow="Initialization"
            title="阶段 1 已完成的基础设施"
            description="这些能力是后面阶段稳定推进的底座，重点保证目录、环境、入口、文档和 Git 流程一致。"
          >
            <ul className="grid gap-3 md:grid-cols-2">
              {initializationChecklist.map((item) => (
                <li
                  key={item}
                  className="rounded-2xl border border-brand-100 bg-brand-50/70 px-4 py-4 text-sm font-medium text-ink-700"
                >
                  {item}
                </li>
              ))}
            </ul>
          </SectionPanel>
        </div>

        <div className="space-y-6">
          <SectionPanel
            eyebrow="Engineering Rules"
            title="开发约束摘要"
            description="阶段 0 文档中的规则已经成为默认基线，后续所有代码都会遵守这些约束。"
          >
            <div className="grid gap-3">
              {[
                '外部服务集成只能进入 service 层，不直接写在路由层',
                '长耗时任务默认异步化，保留进度查询与失败重试能力',
                'AI 返回结果必须二次结构化和校验，不直接暴露原始文本',
                '上传文件、路径、密钥和请求体都必须经过校验',
                '状态枚举、时间格式和 JSON 结构保持统一'
              ].map((rule) => (
                <div
                  key={rule}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-6 text-ink-700"
                >
                  {rule}
                </div>
              ))}
            </div>
          </SectionPanel>

          <SectionPanel
            eyebrow="Next"
            title="接下来最适合继续做什么"
            description="现在最自然的下一步就是进入数据库阶段，把业务实体、关系和迁移体系先稳定下来。"
          >
            <ul className="space-y-3">
              {nextMilestones.map((item) => (
                <li
                  key={item}
                  className="rounded-2xl bg-accent-100/60 px-4 py-4 text-sm font-medium leading-6 text-ink-900"
                >
                  {item}
                </li>
              ))}
            </ul>
          </SectionPanel>
        </div>
      </div>
    </main>
  );
};

export default MainPage;

