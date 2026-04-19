# Fanshi 链路 Draw.io XML

下面这段是可直接导入 draw.io / diagrams.net 的 XML。

使用方式：

1. 打开 draw.io
2. 选择 `File -> Import From -> Device`
3. 把本文件中的 XML 复制到一个 `.drawio` 文件，或直接粘贴保存后导入

```xml
<mxfile host="app.diagrams.net" modified="2026-04-19T00:00:00.000Z" agent="Codex" version="24.7.17" type="device">
  <diagram id="fanshi-pipeline" name="Fanshi Pipeline">
    <mxGraphModel dx="1920" dy="1080" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="2200" pageHeight="1600" math="0" shadow="0">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>

        <mxCell id="title" value="Fanshi AI 视频生产链路" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=22;fontStyle=1;fontColor=#111827;" vertex="1" parent="1">
          <mxGeometry x="20" y="10" width="500" height="30" as="geometry"/>
        </mxCell>

        <mxCell id="lane_frontend" value="Frontend / Browser" style="swimlane;html=1;rounded=1;startSize=28;fillColor=#E8F0FE;strokeColor=#5B8DEF;fontSize=14;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="20" y="60" width="420" height="1460" as="geometry"/>
        </mxCell>
        <mxCell id="lane_backend" value="Backend API / Controllers" style="swimlane;html=1;rounded=1;startSize=28;fillColor=#EAFBF1;strokeColor=#43A047;fontSize=14;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="460" y="60" width="420" height="1460" as="geometry"/>
        </mxCell>
        <mxCell id="lane_services" value="Services / Tasks / Orchestration" style="swimlane;html=1;rounded=1;startSize=28;fillColor=#FFF7E6;strokeColor=#FB8C00;fontSize=14;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="900" y="60" width="500" height="1460" as="geometry"/>
        </mxCell>
        <mxCell id="lane_storage" value="Database / Files / Session" style="swimlane;html=1;rounded=1;startSize=28;fillColor=#F3E8FF;strokeColor=#8E24AA;fontSize=14;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="1420" y="60" width="360" height="1460" as="geometry"/>
        </mxCell>
        <mxCell id="lane_external" value="External AI / Media Providers" style="swimlane;html=1;rounded=1;startSize=28;fillColor=#FFECEC;strokeColor=#E53935;fontSize=14;fontStyle=1;" vertex="1" parent="1">
          <mxGeometry x="1800" y="60" width="360" height="1460" as="geometry"/>
        </mxCell>

        <mxCell id="f1" value="MainPage / Dashboard&#xa;- 顶部状态栏&#xa;- 左列资源分析&#xa;- 中列片段工作台&#xa;- 右下导出卡片" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="20" width="360" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="f2" value="useAppHealth&#xa;GET /api/health&#xa;- backendStatus&#xa;- providers.gemini_image&#xa;- providers.seedance" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="130" width="360" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="f3" value="UploadArea / useVideoUpload&#xa;- 格式校验&#xa;- 大小校验&#xa;- 时长预检查&#xa;- 上传进度" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="250" width="360" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="f4" value="useAnalysis&#xa;- POST /analysis/analyze&#xa;- 超时后 GET /analysis/:videoId 恢复&#xa;- analysis:progress 本地态" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="390" width="360" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="f5" value="AnalysisDisplay&#xa;- 角色资源卡片&#xa;- 场景资源卡片&#xa;- 片段切分预案&#xa;- 资源图失败摘要 / 重试失败项" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="520" width="360" height="110" as="geometry"/>
        </mxCell>
        <mxCell id="f6" value="useSegments&#xa;- POST /segments/split&#xa;- GET /tasks/:taskId&#xa;- split:progress&#xa;- sessionStorage 恢复 split 任务" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="670" width="360" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="f7" value="SegmentCard / useGeneration&#xa;- 手动片段分析&#xa;- prompt 优化&#xa;- 生成片段&#xa;- generation:progress + 轮询" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="810" width="360" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="f8" value="资源图生成前端逻辑&#xa;- POST /resource-images/generate&#xa;- GET /resource-images/:videoId&#xa;- 显示 partial_success / error_summary" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="950" width="360" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="f9" value="VideoMerge / 导出卡片&#xa;- POST /merge/start&#xa;- GET /merge/:taskId/progress&#xa;- GET /merge/:taskId/download" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="1090" width="360" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="f10" value="WebSocket + Session Recovery&#xa;- analysis:progress&#xa;- split:progress&#xa;- generation:progress&#xa;- merge:progress&#xa;- 当前视频上下文过滤" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#5B8DEF;fontSize=12;" vertex="1" parent="lane_frontend">
          <mxGeometry x="20" y="1230" width="360" height="110" as="geometry"/>
        </mxCell>

        <mxCell id="b1" value="systemController&#xa;GET /health&#xa;GET /health/database&#xa;GET /metrics" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#43A047;fontSize=12;" vertex="1" parent="lane_backend">
          <mxGeometry x="20" y="40" width="360" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="b2" value="videoController&#xa;POST /videos/upload&#xa;GET /videos/:id&#xa;DELETE /videos/:id" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#43A047;fontSize=12;" vertex="1" parent="lane_backend">
          <mxGeometry x="20" y="180" width="360" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="b3" value="analysisController&#xa;POST /analysis/analyze&#xa;GET /analysis/:videoId&#xa;POST /analysis/optimize-prompt" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#43A047;fontSize=12;" vertex="1" parent="lane_backend">
          <mxGeometry x="20" y="320" width="360" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="b4" value="segmentController&#xa;POST /segments/split&#xa;GET /segments/:videoId&#xa;POST /segments/:id/analyze" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#43A047;fontSize=12;" vertex="1" parent="lane_backend">
          <mxGeometry x="20" y="460" width="360" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="b5" value="resourceImageController&#xa;GET /resource-images/:videoId&#xa;POST /resource-images/generate" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#43A047;fontSize=12;" vertex="1" parent="lane_backend">
          <mxGeometry x="20" y="600" width="360" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="b6" value="generationController&#xa;POST /generation/generate&#xa;GET /generation/:taskId" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#43A047;fontSize=12;" vertex="1" parent="lane_backend">
          <mxGeometry x="20" y="730" width="360" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="b7" value="mergeController&#xa;POST /merge/start&#xa;GET /merge/:taskId/progress&#xa;GET /merge/:taskId/download" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#43A047;fontSize=12;" vertex="1" parent="lane_backend">
          <mxGeometry x="20" y="860" width="360" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="b8" value="taskController&#xa;GET /tasks/:taskId&#xa;split / merge 内存任务查询" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#43A047;fontSize=12;" vertex="1" parent="lane_backend">
          <mxGeometry x="20" y="990" width="360" height="70" as="geometry"/>
        </mxCell>

        <mxCell id="s1" value="providerHealthService&#xa;- geminiImage readiness&#xa;- seedance readiness&#xa;- reason / model / allow_mock_fallback" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="30" width="420" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="s2" value="videoService&#xa;- 创建项目/视频&#xa;- 元数据校验&#xa;- 重复上传检查&#xa;- hash 文件名保存" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="170" width="420" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="s3" value="analysisService&#xa;- analyzeVideoById&#xa;- analyzeSegmentContent&#xa;- optimizePrompt" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="300" width="420" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="s4" value="segmentService&#xa;- normalizeTimeAnchors&#xa;- buildBaseSegmentAnalysis&#xa;- split 后自动片段理解" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="430" width="420" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="s5" value="taskService&#xa;- createTask&#xa;- updateTask&#xa;- completeTask / failTask&#xa;- split/merge 内存任务" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="560" width="420" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="s6" value="resourceImageService&#xa;- 建 / 复用 resource_image_assets&#xa;- 逐变体调用 Gemini Image&#xa;- 汇总 partial_success / error_summary" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="690" width="420" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="s7" value="backgroundAssetService&#xa;- ensureBackgroundAsset&#xa;- 按 videoId + backgroundId 唯一复用&#xa;- 首次命中自动补建背景参考视频" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="830" width="420" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="s8" value="generationService&#xa;- startGeneration 前 assertSeedDanceReady&#xa;- processGenerationTask&#xa;- 扩展 @角色 / #场景&#xa;- 汇总 reference_image / reference_video" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="970" width="420" height="110" as="geometry"/>
        </mxCell>
        <mxCell id="s9" value="seedDanceService&#xa;- build content[]&#xa;- POST create task&#xa;- GET poll task&#xa;- download remote video&#xa;- 默认不静默 mock" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="1120" width="420" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="s10" value="mergeService&#xa;- 读取所有片段&#xa;- 优先最新成功生成结果&#xa;- 否则回退原片段&#xa;- FFmpeg merge 输出成片" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="1260" width="420" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="s11" value="realtimeService&#xa;- WebSocket server&#xa;- analysis:progress&#xa;- split:progress&#xa;- generation:progress&#xa;- merge:progress" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#FB8C00;fontSize=12;" vertex="1" parent="lane_services">
          <mxGeometry x="20" y="1390" width="420" height="80" as="geometry"/>
        </mxCell>

        <mxCell id="d1" value="MySQL&#xa;projects&#xa;videos&#xa;analyses&#xa;segments&#xa;background_assets&#xa;resource_image_assets&#xa;generation_tasks(meta)" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#8E24AA;fontSize=12;" vertex="1" parent="lane_storage">
          <mxGeometry x="20" y="70" width="300" height="180" as="geometry"/>
        </mxCell>
        <mxCell id="d2" value="uploads/videos&#xa;原始上传视频" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#8E24AA;fontSize=12;" vertex="1" parent="lane_storage">
          <mxGeometry x="20" y="320" width="300" height="70" as="geometry"/>
        </mxCell>
        <mxCell id="d3" value="uploads/segments&#xa;FFmpeg 切片结果" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#8E24AA;fontSize=12;" vertex="1" parent="lane_storage">
          <mxGeometry x="20" y="430" width="300" height="70" as="geometry"/>
        </mxCell>
        <mxCell id="d4" value="uploads/resource-images&#xa;角色三视图 / 场景多角度图" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#8E24AA;fontSize=12;" vertex="1" parent="lane_storage">
          <mxGeometry x="20" y="540" width="300" height="80" as="geometry"/>
        </mxCell>
        <mxCell id="d5" value="uploads/outputs&#xa;Seedance 结果视频&#xa;背景资产视频&#xa;最终 merge 成片" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#8E24AA;fontSize=12;" vertex="1" parent="lane_storage">
          <mxGeometry x="20" y="660" width="300" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="d6" value="sessionStorage&#xa;currentVideoId&#xa;splitTaskId&#xa;mergeTaskId" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#8E24AA;fontSize=12;" vertex="1" parent="lane_storage">
          <mxGeometry x="20" y="800" width="300" height="80" as="geometry"/>
        </mxCell>

        <mxCell id="e1" value="Gemini Text / Multimodal&#xa;- 整片分析&#xa;- 片段分析&#xa;- prompt 优化" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#E53935;fontSize=12;" vertex="1" parent="lane_external">
          <mxGeometry x="20" y="120" width="300" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="e2" value="Gemini Image&#xa;- 角色三视图&#xa;- 场景多角度图" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#E53935;fontSize=12;" vertex="1" parent="lane_external">
          <mxGeometry x="20" y="280" width="300" height="90" as="geometry"/>
        </mxCell>
        <mxCell id="e3" value="Seedance&#xa;- 创建视频生成任务&#xa;- 查询任务状态&#xa;- 返回远端 video_url" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#E53935;fontSize=12;" vertex="1" parent="lane_external">
          <mxGeometry x="20" y="460" width="300" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="e4" value="FFmpeg / ffprobe&#xa;- 元数据&#xa;- 切片&#xa;- 抽帧&#xa;- 合并" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFFFF;strokeColor=#E53935;fontSize=12;" vertex="1" parent="lane_external">
          <mxGeometry x="20" y="640" width="300" height="100" as="geometry"/>
        </mxCell>
        <mxCell id="e5" value="当前运行状态&#xa;gemini_image.ready = true&#xa;seedance.ready = false&#xa;reason = 缺少 SEED_DANCE_API_KEY" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FFF3F3;strokeColor=#E53935;fontSize=12;fontStyle=1;" vertex="1" parent="lane_external">
          <mxGeometry x="20" y="820" width="300" height="100" as="geometry"/>
        </mxCell>

        <mxCell id="edge_f2_b1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#4A6CF7;" edge="1" parent="1" source="f2" target="b1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_b1_s1" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#43A047;" edge="1" parent="1" source="b1" target="s1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s1_e2" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;" edge="1" parent="1" source="s1" target="e2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s1_e3" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;" edge="1" parent="1" source="s1" target="e3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>

        <mxCell id="edge_f3_b2" value="upload" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4A6CF7;fontSize=11;" edge="1" parent="1" source="f3" target="b2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_b2_s2" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#43A047;" edge="1" parent="1" source="b2" target="s2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s2_d1" value="create video/project" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s2" target="d1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s2_d2" value="save file" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s2" target="d2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s2_e4" value="ffprobe metadata" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s2" target="e4">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>

        <mxCell id="edge_f4_b3" value="analyze video" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4A6CF7;fontSize=11;" edge="1" parent="1" source="f4" target="b3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_b3_s3" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#43A047;" edge="1" parent="1" source="b3" target="s3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s3_e1" value="Gemini analyze / optimize" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s3" target="e1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s3_d1" value="upsert analyses" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s3" target="d1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>

        <mxCell id="edge_f6_b4" value="split video" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4A6CF7;fontSize=11;" edge="1" parent="1" source="f6" target="b4">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_b4_s4" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#43A047;" edge="1" parent="1" source="b4" target="s4">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s4_s5" value="split task" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s4" target="s5">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s4_e4" value="ffmpeg split / frame extract" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s4" target="e4">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s4_d3" value="save segments" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s4" target="d3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s4_d1" value="insert segments" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s4" target="d1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s5_b8" value="task query" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s5" target="b8">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s5_s11" value="split:progress / merge:progress" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s5" target="s11">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s11_f10" value="websocket" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s11" target="f10">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_f10_d6" value="restore task ids" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4A6CF7;fontSize=11;" edge="1" parent="1" source="f10" target="d6">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>

        <mxCell id="edge_f8_b5" value="generate images" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4A6CF7;fontSize=11;" edge="1" parent="1" source="f8" target="b5">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_b5_s6" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#43A047;" edge="1" parent="1" source="b5" target="s6">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s6_e2" value="Gemini image generateContent" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s6" target="e2">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s6_d4" value="save resource images" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s6" target="d4">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s6_d1" value="upsert resource_image_assets" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s6" target="d1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>

        <mxCell id="edge_f7_b6" value="generate segment" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4A6CF7;fontSize=11;" edge="1" parent="1" source="f7" target="b6">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_b6_s8" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#43A047;" edge="1" parent="1" source="b6" target="s8">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s8_s7" value="ensure background asset" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s8" target="s7">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s7_e3" value="background reference video" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s7" target="e3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s7_d1" value="upsert background_assets" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s7" target="d1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s7_d5" value="save background asset video" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s7" target="d5">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s8_d1" value="create generation_tasks / update meta" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s8" target="d1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s8_s9" value="build prompt + refs" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s8" target="s9">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s9_e3" value="Seedance task create / poll" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s9" target="e3">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s9_d5" value="download generated video" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s9" target="d5">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s8_s11" value="generation:progress" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s8" target="s11">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>

        <mxCell id="edge_f9_b7" value="merge" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#4A6CF7;fontSize=11;" edge="1" parent="1" source="f9" target="b7">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_b7_s10" value="" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#43A047;" edge="1" parent="1" source="b7" target="s10">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s10_e4" value="ffmpeg merge" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s10" target="e4">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s10_d5" value="save merged video" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s10" target="d5">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="edge_s10_s5" value="merge task progress" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#FB8C00;fontSize=11;" edge="1" parent="1" source="s10" target="s5">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```

这张图覆盖了：

- 前端主工作台、状态 hook、轮询和 WebSocket
- 后端控制器入口
- service 编排层
- 数据库与本地文件
- Gemini 文本、Gemini 生图、Seedance、FFmpeg
- 当前真实运行状态中的 provider readiness
