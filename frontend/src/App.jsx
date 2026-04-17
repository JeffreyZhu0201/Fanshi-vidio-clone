import { Suspense, lazy } from 'react';

const MainPage = lazy(() => import('./pages/MainPage.jsx'));

const AppFallback = () => {
  return (
    <div className="min-h-screen bg-slate-950 px-6 py-10 text-white">
      <div className="mx-auto flex max-w-4xl flex-col gap-4 rounded-[32px] border border-white/10 bg-white/5 p-8 shadow-2xl shadow-slate-950/40">
        <p className="text-xs font-semibold uppercase tracking-[0.34em] text-white/45">
          Fanshi Workbench
        </p>
        <h1 className="text-3xl font-black tracking-tight">正在加载前端工作台</h1>
        <p className="max-w-2xl text-sm leading-7 text-white/70">
          阶段 5 已启用页面级懒加载，首屏会先渲染轻量壳层，再异步加载主工作区。
        </p>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-gradient-to-r from-brand-400 to-accent-400" />
        </div>
      </div>
    </div>
  );
};

const App = () => {
  return (
    <Suspense fallback={<AppFallback />}>
      <MainPage />
    </Suspense>
  );
};

export default App;
