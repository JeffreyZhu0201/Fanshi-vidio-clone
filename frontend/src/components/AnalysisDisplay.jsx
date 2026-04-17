import PropTypes from 'prop-types';

import ProgressBar from './ProgressBar.jsx';
import PromptPreview from './PromptPreview.jsx';
import SectionPanel from './SectionPanel.jsx';
import StatusBadge from './StatusBadge.jsx';
import VideoFramePreview from './VideoFramePreview.jsx';
import { formatDuration } from '../utils/formatDuration.js';
import { buildVideoAnalysisPrompt } from '../utils/promptBlueprints.js';

const getBackgroundName = (background, index) => {
  if (typeof background === 'string') {
    return `场景 ${index + 1}`;
  }

  return background?.name || background?.title || background?.sceneName || `场景 ${index + 1}`;
};

const getBackgroundDescription = (background) => {
  if (typeof background === 'string') {
    return background;
  }

  return background?.description || background?.summary || '暂无背景描述';
};

const getCharacterPrompt = (character) => {
  return (
    character?.appearancePrompt ||
    character?.appearance_prompt ||
    character?.prompt ||
    character?.description ||
    '等待补充角色设定'
  );
};

const getScenePrompt = (item, fallback = '暂无镜头提示词。') => {
  return item?.scenePrompt || item?.scene_prompt || fallback;
};

const getRepresentativeFrameTime = (item) => {
  const value = Number(item?.representativeFrameTime ?? item?.representative_frame_time);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

const getRepresentativeFrameNote = (item, fallback = '') => {
  return (
    item?.representativeFrameNote ||
    item?.representative_frame_note ||
    item?.representativeFrameReason ||
    item?.representative_frame_reason ||
    fallback
  );
};

const getMockFailureSummary = (analysis) => {
  const remoteError = String(analysis?.remote_error || '');

  if (analysis?.fallback_reason === 'missing_remote_config') {
    return 'Gemini 远端配置缺失，当前展示的是本地回退结果。';
  }

  if (/status 429|resource has been exhausted|quota/iu.test(remoteError)) {
    return 'Gemini 真实分析失败，当前展示的是本地回退结果。上游返回 429，额度或并发已耗尽。';
  }

  return 'Gemini 真实分析失败，当前展示的是本地回退结果。';
};

const AnalysisDisplay = ({
  video = null,
  analysis = null,
  loading = false,
  error = '',
  progress = 0,
  status = 'idle',
  statusMessage = '',
  splitProgress = {
    status: 'idle',
    progress: 0,
    message: ''
  },
  onAnalyze,
  onSplit
}) => {
  const characters = analysis?.characters ?? [];
  const backgrounds = analysis?.backgrounds ?? [];
  const timeAnchors = analysis?.time_anchors ?? [];
  const sceneCards = backgrounds.length
    ? backgrounds
    : timeAnchors.map((anchor, index) => ({
        id: `derived-scene-${index + 1}`,
        name: `场景 ${index + 1}`,
        description: anchor.sceneSummary || '暂无场景概览',
        scenePrompt: getScenePrompt(anchor, anchor.sceneSummary || '暂无镜头提示词。'),
        representativeFrameTime: getRepresentativeFrameTime(anchor),
        representativeFrameNote: getRepresentativeFrameNote(anchor)
      }));
  const analysisFrameSource = video?.file_url || '';
  const videoAnalysisPrompt = video ? buildVideoAnalysisPrompt({ video }) : '';
  const analysisStatusLabel = analysis?.is_mock ? 'Gemini失败已回退' : 'Gemini真实结果';
  const analysisStatusTone = analysis?.is_mock ? 'fallback' : 'completed';
  const keyFrameCount = [...characters, ...sceneCards].filter((item) => {
    return getRepresentativeFrameTime(item) !== null;
  }).length;
  const timeAnchorPromptCount = timeAnchors.filter((anchor) => {
    return Boolean(getScenePrompt(anchor, '').trim());
  }).length;

  return (
    <SectionPanel
      eyebrow="Analysis"
      title="整片分析总览"
      description="这一栏集中展示剧情摘要、角色设定、场景资料、镜头提示词与时间锚点，也负责触发整片分析和分镜切分。"
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-white/80 transition hover:border-white/20 hover:bg-white/[0.06]"
            onClick={() => void onAnalyze()}
            disabled={!video || loading}
          >
            {analysis ? '重新分析' : '开始分析'}
          </button>
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-brand-500 to-accent-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void onSplit()}
            disabled={!analysis?.time_anchors?.length || splitProgress.status === 'processing'}
          >
            生成片段
          </button>
        </div>
      }
    >
      {!video ? (
        <div className="rounded-[28px] border border-dashed border-white/[0.12] bg-white/[0.04] px-6 py-12 text-center">
          <p className="text-lg font-semibold text-white">先上传一个原视频</p>
          <p className="mt-2 text-sm leading-6 text-white/60">
            上传完成后，这里会显示剧情摘要、角色卡片、场景卡片、典型帧和镜头提示词时间轴。
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
            <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,15,35,0.96),rgba(4,6,14,0.96)),radial-gradient(circle_at_top_right,rgba(225,29,72,0.18),transparent_28%)] px-5 py-5 text-white">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-white/40">Current Asset</p>
                  <h3 className="mt-3 text-2xl font-bold">{video.filename}</h3>
                </div>
                <StatusBadge status={analysis ? analysisStatusTone : 'idle'} label={analysis ? analysisStatusLabel : '等待分析'} />
              </div>

              <p className="mt-3 max-w-3xl text-sm leading-7 text-white/70">
                当前工作流会围绕这条原视频推进整片理解、角色抽取、场景资产整理、镜头锚点拆分和分镜生成。
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <span className="toolbar-pill">角色 {characters.length}</span>
                <span className="toolbar-pill">场景 {sceneCards.length}</span>
                <span className="toolbar-pill">镜头 {timeAnchors.length}</span>
                <span className="toolbar-pill">典型帧 {keyFrameCount}</span>
                <span className="toolbar-pill">镜头提示词 {timeAnchorPromptCount}</span>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <p className="text-xs uppercase tracking-[0.26em] text-white/50">时长</p>
                <p className="mt-2 text-xl font-bold text-white">
                  {video.duration ? formatDuration(video.duration) : '待探测'}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <p className="text-xs uppercase tracking-[0.26em] text-white/50">模型来源</p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {analysis?.provider || '等待分析'}
                  {analysis?.model ? ` · ${analysis.model}` : ''}
                </p>
              </div>
              <div className="rounded-[24px] border border-white/10 bg-white/[0.04] px-4 py-4">
                <p className="text-xs uppercase tracking-[0.26em] text-white/50">鉴权方式</p>
                <p className="mt-2 text-sm font-semibold text-white">
                  {analysis?.auth_variant || '等待调用'}
                </p>
              </div>
            </div>
          </div>

          {(loading || status === 'processing') && (
            <div className="rounded-[26px] border border-brand-500/20 bg-brand-500/10 px-5 py-4">
              <ProgressBar
                value={progress}
                status={status}
                label={statusMessage || '正在分析整片视频'}
              />
            </div>
          )}

          {splitProgress.status !== 'idle' ? (
            <div className="rounded-[26px] border border-white/10 bg-white/[0.04] px-5 py-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">片段切分任务</p>
                <StatusBadge status={splitProgress.status} />
              </div>
              <ProgressBar
                value={splitProgress.progress}
                status={splitProgress.status}
                label={splitProgress.message || '正在根据时间锚点拆分片段'}
              />
            </div>
          ) : null}

          {video ? (
            <PromptPreview
              title="整片分析提示词"
              description="开始分析时，后端会把原视频和这段提示词一起发送给 Gemini，产出剧情、角色、场景、典型帧和时间锚点。"
              prompt={videoAnalysisPrompt}
              modelLabel="Gemini"
            />
          ) : null}

          {analysis?.is_mock ? (
            <div
              role="alert"
              className="rounded-[26px] border border-amber-500/20 bg-amber-500/10 px-5 py-4 text-sm text-amber-100"
            >
              <p className="font-semibold">{getMockFailureSummary(analysis)}</p>
              <p className="mt-2 leading-6 text-amber-50/80">
                这意味着这次并没有拿到 Gemini 的真实整片理解数据，页面里当前展示的是后端回退生成的 mock 结果。
              </p>
              <div className="mt-3 grid gap-2 text-xs leading-5 text-amber-50/80 md:grid-cols-2">
                <p>模型：{analysis.model || '未知'}</p>
                <p>调用模式：{analysis.mode || '未知'}</p>
                <p>鉴权方式：{analysis.auth_variant || '未知'}</p>
                <p>回退原因：{analysis.fallback_reason || 'remote_error'}</p>
              </div>
              {analysis.remote_error ? (
                <p className="mt-3 rounded-[18px] border border-amber-400/10 bg-black/20 px-3 py-2 text-xs leading-5 text-amber-100">
                  远端错误：{analysis.remote_error}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-[26px] border border-accent-500/20 bg-accent-500/10 px-5 py-4 text-sm text-rose-200"
            >
              {error}
            </div>
          ) : null}

          {analysis ? (
            <>
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(340px,0.95fr)]">
                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] px-5 py-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.26em] text-white/50">Plot</p>
                      <h3 className="mt-2 text-xl font-bold text-white">剧情摘要</h3>
                    </div>
                    <StatusBadge status={analysisStatusTone} label={analysisStatusLabel} />
                  </div>
                  {(analysis?.provider || analysis?.model || analysis?.auth_variant) ? (
                    <p className="mb-3 text-xs uppercase tracking-[0.18em] text-white/40">
                      {analysis.provider || 'remote-gemini'}
                      {analysis.model ? ` · ${analysis.model}` : ''}
                      {analysis.auth_variant ? ` · ${analysis.auth_variant}` : ''}
                    </p>
                  ) : null}
                  <p className="text-sm leading-7 text-white/80">{analysis.plot || '暂无剧情内容。'}</p>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(30,27,75,0.45),rgba(0,0,0,0.4))] px-5 py-5">
                  <p className="text-xs uppercase tracking-[0.26em] text-white/50">Analysis Intelligence</p>
                  <h3 className="mt-2 text-xl font-bold text-white">关键结果看板</h3>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-white/45">角色卡片</p>
                      <p className="mt-2 text-2xl font-black text-white">{characters.length}</p>
                      <p className="mt-2 text-xs leading-5 text-white/55">人物外观设定与典型帧已汇总。</p>
                    </div>
                    <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-white/45">场景资料</p>
                      <p className="mt-2 text-2xl font-black text-white">{sceneCards.length}</p>
                      <p className="mt-2 text-xs leading-5 text-white/55">场景说明、提示词与典型帧同区展示。</p>
                    </div>
                    <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-white/45">镜头锚点</p>
                      <p className="mt-2 text-2xl font-black text-white">{timeAnchors.length}</p>
                      <p className="mt-2 text-xs leading-5 text-white/55">可直接用于后续切分与片段工位生成。</p>
                    </div>
                    <div className="rounded-[22px] border border-white/10 bg-black/20 px-4 py-4">
                      <p className="text-xs uppercase tracking-[0.22em] text-white/45">提示词覆盖</p>
                      <p className="mt-2 text-2xl font-black text-white">{timeAnchorPromptCount}</p>
                      <p className="mt-2 text-xs leading-5 text-white/55">镜头级场景提示词已记录并可复用。</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
                <div className="space-y-5">
                  <div className="rounded-[28px] border border-white/10 bg-white/[0.04] px-5 py-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.26em] text-white/50">Characters</p>
                        <h3 className="mt-2 text-xl font-bold text-white">角色形象卡片</h3>
                      </div>
                      <StatusBadge status={characters.length ? 'completed' : 'idle'} label={`${characters.length} 个角色`} />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {characters.length ? (
                        characters.map((character, index) => (
                          <article
                            key={character.id || character.name || index}
                            className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4"
                          >
                            <VideoFramePreview
                              videoUrl={analysisFrameSource}
                              timeSeconds={getRepresentativeFrameTime(character)}
                              label={`角色 ${index + 1}`}
                              note={getRepresentativeFrameNote(
                                character,
                                '用于稳定人物形象的典型帧'
                              )}
                            />

                            <div className="mt-4 flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-white/40">Identity</p>
                                <h4 className="mt-2 text-lg font-semibold text-white">
                                  {character.name || `角色 ${index + 1}`}
                                </h4>
                              </div>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white/70">
                                {getRepresentativeFrameTime(character) !== null ? '含典型帧' : '待补典型帧'}
                              </span>
                            </div>

                            <p className="mt-3 text-sm leading-6 text-white/70">
                              {getCharacterPrompt(character)}
                            </p>
                          </article>
                        ))
                      ) : (
                        <div className="rounded-[24px] border border-dashed border-white/[0.12] px-4 py-5 text-sm text-white/50">
                          暂无角色设定。
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[28px] border border-white/10 bg-white/[0.04] px-5 py-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs uppercase tracking-[0.26em] text-white/50">Scene Library</p>
                        <h3 className="mt-2 text-xl font-bold text-white">场景与背景描述</h3>
                      </div>
                      <StatusBadge status={sceneCards.length ? 'completed' : 'idle'} label={`${sceneCards.length} 个场景`} />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {sceneCards.length ? (
                        sceneCards.map((background, index) => (
                          <article
                            key={background.id || `${getBackgroundName(background, index)}-${index}`}
                            className="rounded-[24px] border border-white/10 bg-black/20 px-4 py-4"
                          >
                            <VideoFramePreview
                              videoUrl={analysisFrameSource}
                              timeSeconds={getRepresentativeFrameTime(background)}
                              label={getBackgroundName(background, index)}
                              note={getRepresentativeFrameNote(
                                background,
                                '用于表示场景空间与光线关系的典型帧'
                              )}
                            />

                            <div className="mt-4 flex items-start justify-between gap-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-white/40">Scene</p>
                                <h4 className="mt-2 text-lg font-semibold text-white">
                                  {getBackgroundName(background, index)}
                                </h4>
                              </div>
                              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-white/70">
                                场景卡
                              </span>
                            </div>

                            <p className="mt-3 text-sm leading-6 text-white/70">
                              {getBackgroundDescription(background)}
                            </p>

                            <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.04] px-3 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                                场景提示词
                              </p>
                              <p className="mt-2 text-sm leading-6 text-white/80">
                                {getScenePrompt(background, '暂无场景提示词。')}
                              </p>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="rounded-[24px] border border-dashed border-white/[0.12] px-4 py-5 text-sm text-white/50">
                          暂无背景描述。
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] px-5 py-5">
                  <div className="mb-5 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.26em] text-white/50">Timeline</p>
                      <h3 className="mt-2 text-xl font-bold text-white">时间轴与镜头提示词</h3>
                    </div>
                    <StatusBadge status={timeAnchors.length ? 'completed' : 'idle'} label={`${timeAnchors.length} 个镜头`} />
                  </div>

                  <div className="space-y-4">
                    {timeAnchors.length ? (
                      timeAnchors.map((anchor, index) => (
                        <article key={`${anchor.startTime}-${anchor.endTime}-${index}`} className="timeline-item ml-3">
                          <div className="grid gap-4 lg:grid-cols-[180px_minmax(0,1fr)]">
                            <VideoFramePreview
                              videoUrl={analysisFrameSource}
                              timeSeconds={getRepresentativeFrameTime(anchor)}
                              label={`镜头 ${index + 1}`}
                              note={getRepresentativeFrameNote(anchor, '该镜头段的代表画面')}
                              className="lg:max-w-[180px]"
                            />

                            <div className="min-w-0">
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold text-white">镜头 {index + 1}</p>
                                  <p className="mt-1 text-xs text-white/40">
                                    {formatDuration(Number(anchor.startTime))} -{' '}
                                    {formatDuration(Number(anchor.endTime))}
                                  </p>
                                </div>
                                <StatusBadge
                                  status="completed"
                                  label={`${Math.max(
                                    1,
                                    Math.round(Number(anchor.endTime) - Number(anchor.startTime))
                                  )}s`}
                                />
                              </div>

                              <p className="mt-3 text-sm leading-6 text-white/75">
                                {anchor.sceneSummary || '暂无镜头摘要。'}
                              </p>

                              <div className="mt-4 rounded-[20px] border border-white/10 bg-black/20 px-3 py-3">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
                                  场景描述提示词
                                </p>
                                <p className="mt-2 text-sm leading-6 text-white/80">
                                  {getScenePrompt(anchor, '暂无镜头提示词。')}
                                </p>
                              </div>
                            </div>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="rounded-[24px] border border-dashed border-white/[0.12] px-4 py-5 text-sm text-white/50">
                        暂无时间锚点。
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-[28px] border border-dashed border-white/[0.12] bg-white/[0.04] px-6 py-12 text-center">
              <p className="text-lg font-semibold text-white">整片分析尚未开始</p>
              <p className="mt-2 text-sm leading-6 text-white/60">
                点击右上角的“开始分析”，就可以生成剧情、角色、场景卡片、典型帧和镜头提示词结果。
              </p>
            </div>
          )}
        </div>
      )}
    </SectionPanel>
  );
};

AnalysisDisplay.propTypes = {
  video: PropTypes.shape({
    id: PropTypes.number,
    filename: PropTypes.string,
    duration: PropTypes.number,
    file_url: PropTypes.string
  }),
  analysis: PropTypes.shape({
    plot: PropTypes.string,
    characters: PropTypes.arrayOf(PropTypes.object),
    backgrounds: PropTypes.arrayOf(PropTypes.oneOfType([PropTypes.string, PropTypes.object])),
    time_anchors: PropTypes.arrayOf(PropTypes.object),
    provider: PropTypes.string,
    model: PropTypes.string,
    mode: PropTypes.string,
    auth_variant: PropTypes.string,
    is_mock: PropTypes.bool,
    fallback_reason: PropTypes.string,
    remote_error: PropTypes.string
  }),
  loading: PropTypes.bool,
  error: PropTypes.string,
  progress: PropTypes.number,
  status: PropTypes.string,
  statusMessage: PropTypes.string,
  splitProgress: PropTypes.shape({
    status: PropTypes.string,
    progress: PropTypes.number,
    message: PropTypes.string
  }),
  onAnalyze: PropTypes.func.isRequired,
  onSplit: PropTypes.func.isRequired
};

export default AnalysisDisplay;
