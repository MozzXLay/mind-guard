import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { api, errorText, type RestorePreview, type VaultStatus } from './api';
import Onboarding from '../features/onboarding/Onboarding';
import Today from '../features/today/Today';
import AnonymousSos from '../features/sos/AnonymousSos';

const navigation = [
  ['today', '今日', '◒'], ['records', '记录', '▤'], ['sos', 'SOS', '◉'],
  ['plan', '计划', '◇'], ['insights', '洞察', '▥'], ['journal', '日记', '≋'],
  ['blocker', '屏蔽', '⊘'],
] as const;

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('mindguard-theme') === 'light' ? 'light' : 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mindguard-theme', theme);
  }, [theme]);
  return [theme, setTheme] as const;
}

export default function App() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [goals, setGoals] = useState<string[]>([]);
  const [startupError, setStartupError] = useState('');
  const [anonymousSos, setAnonymousSos] = useState(false);
  const [theme, setTheme] = useTheme();
  const lastTouch = useRef(Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await api.status();
      setStatus(next);
      setStartupError('');
      if (next.unlocked) setGoals(await api.goals());
      else setGoals([]);
    } catch (cause) {
      setStartupError(errorText(cause));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const lock = useCallback(async () => {
    setGoals([]);
    setStatus((current) => current ? { ...current, unlocked: false } : current);
    try { setStatus(await api.lock()); }
    catch (cause) { setStartupError(errorText(cause)); }
  }, []);

  useEffect(() => {
    if (!status?.unlocked) return;
    const timeout = status.autoLockMinutes * 60 * 1000;
    let lastInput = Date.now();
    const onInput = () => {
      lastInput = Date.now();
      if (lastInput - lastTouch.current > 30_000) {
        lastTouch.current = lastInput;
        void api.touch().catch(() => void lock());
      }
    };
    const onVisibility = () => { if (document.hidden) void lock(); else void refresh(); };
    const interval = window.setInterval(() => { if (Date.now() - lastInput >= timeout) void lock(); }, 5000);
    for (const event of ['keydown', 'pointerdown', 'pointermove', 'touchstart']) window.addEventListener(event, onInput, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      for (const event of ['keydown', 'pointerdown', 'pointermove', 'touchstart']) window.removeEventListener(event, onInput);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [status?.unlocked, status?.autoLockMinutes, lock, refresh]);

  if (startupError && !status) return <main className="auth-screen"><section className="auth-panel">
    <h1>本地存储尚未就绪</h1><p role="alert">{startupError}</p>
    <button className="button primary" onClick={() => void refresh()}>重试</button>
  </section></main>;
  if (!status) return <main className="auth-screen"><p role="status">正在打开本地空间…</p></main>;
  if (!status.initialized) return <Onboarding onCreated={(next) => { setStatus(next); void refresh(); }} />;
  if (anonymousSos) return <AnonymousSos standalone onLeave={() => setAnonymousSos(false)} />;
  if (!status.unlocked) return <LockScreen onUnlocked={(next) => { setStatus(next); void refresh(); }} onSos={() => setAnonymousSos(true)} />;

  return <HashRouter><Shell status={status} goals={goals} theme={theme} setTheme={setTheme} onLock={lock} onStatus={setStatus} onGoals={setGoals} /></HashRouter>;
}

function LockScreen({ onUnlocked, onSos }: { onUnlocked: (status: VaultStatus) => void; onSos: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { const next = await api.unlock(password); setPassword(''); onUnlocked(next); }
    catch (cause) { setError(errorText(cause)); setPassword(''); }
    finally { setBusy(false); }
  }
  return <main className="auth-screen"><form className="auth-panel lock-panel" onSubmit={submit}>
    <span className="brandmark" aria-hidden="true" /><h1>欢迎回来。</h1>
    <p>你的本地空间已锁定。输入主密码后继续。</p>
    <label className="field">主密码<input autoFocus type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <p role="alert" className="message error">{error}</p>}
    <div className="form-actions"><button className="button primary" disabled={busy || !password}>{busy ? '正在验证…' : '解锁'}</button><button type="button" className="button ghost" onClick={onSos}>无需记录的 SOS</button></div>
    <button type="button" className="text-button" aria-expanded={showHelp} onClick={() => setShowHelp(!showHelp)}>忘记密码？</button>
    {showHelp && <p className="small muted">没有服务端恢复。遗失主密码后，旧数据库和备份无法解锁。新建空库会舍弃旧数据，请先保留原始文件以便将来想起密码时重试。</p>}
  </form></main>;
}

type ShellProps = {
  status: VaultStatus; goals: string[]; theme: string;
  setTheme: (theme: string) => void; onLock: () => void;
  onStatus: (status: VaultStatus) => void; onGoals: (goals: string[]) => void;
};

export function Shell({ status, goals, theme, setTheme, onLock, onStatus, onGoals }: ShellProps) {
  const navigate = useNavigate();
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brandmark" aria-hidden="true" /><span className="brand-label">净界</span></div>
      <p className="nav-heading">我的空间</p>
      <nav aria-label="主导航" className="nav-list">
        {navigation.map(([path, label, icon]) => <NavLink to={`/${path}`} key={path} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} aria-label={label}><span className="nav-icon" aria-hidden="true">{icon}</span><span className="nav-label">{label}</span></NavLink>)}
      </nav>
      <div className="sidebar-footer">
        <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} aria-label="设置与隐私"><span className="nav-icon" aria-hidden="true">⚙</span><span className="nav-label">设置与隐私</span></NavLink>
        <p className="sidebar-status">本地运行 · 已加密</p>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar"><span>净界 / 私密空间</span><div><span className="top-date">{new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date())}</span><button className="button small-button" onClick={onLock}>立即锁定</button></div></header>
      <div className="content">
        <Routes>
          <Route path="/today" element={<Today goals={goals} onSos={() => navigate('/sos')} />} />
          <Route path="/sos" element={<AnonymousSos onLeave={() => navigate('/today')} />} />
          <Route path="/records" element={<ComingSoon title="记录，不用评判。" detail="事件记录、历史编辑和删除将在 M1 开放。当前不会保存或展示演示记录。" />} />
          <Route path="/plan" element={<ComingSoon title="一个能调整的计划。" detail="目标编辑和小行动将在 M1 开放。引导时选择的目标已保存在加密数据库中。" goals={goals} />} />
          <Route path="/insights" element={<ComingSoon title="把规律看清一点。" detail="7/30 天统计将在 M1 从真实记录计算。当前没有样本，不作趋势判断。" />} />
          <Route path="/journal" element={<ComingSoon title="写给自己的几句话。" detail="日记将在 M1 开放；当前没有日记输入或明文暂存。" />} />
          <Route path="/blocker" element={<ComingSoon title="降低访问的便利性。" detail="浏览器扩展属于 M2。Firefox 与 Chromium 均未连接，当前没有规则生效。" />} />
          <Route path="/settings" element={<Settings status={status} theme={theme} setTheme={setTheme} onStatus={onStatus} onGoals={onGoals} />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </div>
    </main>
  </div>;
}

function ComingSoon({ title, detail, goals }: { title: string; detail: string; goals?: string[] }) {
  return <><p className="kicker">阶段状态</p><h1 className="page-title">{title}</h1><section className="card coming-soon"><span className="pill">后续里程碑</span><h2>此功能尚未开放</h2><p className="muted">{detail}</p>{goals && goals.length > 0 && <ul className="goal-list">{goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>}</section></>;
}

function Settings({ status, theme, setTheme, onStatus, onGoals }: {
  status: VaultStatus; theme: string; setTheme: (theme: string) => void;
  onStatus: (status: VaultStatus) => void; onGoals: (goals: string[]) => void;
}) {
  const [backupPassword, setBackupPassword] = useState('');
  const [backupPath, setBackupPath] = useState('');
  const [restorePassword, setRestorePassword] = useState('');
  const [restorePath, setRestorePath] = useState('');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  async function chooseBackup() {
    const path = await open({ multiple: false, directory: false, filters: [{ name: '净界加密备份', extensions: ['mgb'] }] });
    if (typeof path === 'string') { setRestorePath(path); setPreview(null); setMessage('已选择备份文件。请输入创建备份时的主密码并预览。'); }
  }

  return <><p className="kicker">SETTINGS / 08</p><h1 className="page-title">设置与隐私。</h1><p className="subtitle">控制外观、自动锁定和加密备份。</p>
    <div className="card-grid">
      <section className="card"><h2>外观与使用</h2>
        <label className="field">主题<select value={theme} onChange={(e) => setTheme(e.target.value)}><option value="dark">深色</option><option value="light">浅色</option></select></label>
        <label className="field">自动锁定<select value={status.autoLockMinutes} disabled={busy} onChange={(e) => void run(async () => onStatus(await api.setAutoLock(Number(e.target.value))))}><option value={5}>5 分钟</option><option value={10}>10 分钟</option><option value={30}>30 分钟</option></select></label>
        <p className="small muted">窗口隐藏时立即锁定。提醒和开机启动默认关闭。</p>
      </section>
      <section className="card"><h2>创建加密备份</h2><p className="muted">再次输入主密码。备份保存在应用私有目录的 backups 文件夹内。</p>
        <label className="field">主密码<input type="password" autoComplete="current-password" value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} /></label>
        <button className="button primary" disabled={busy || !backupPassword} onClick={() => void run(async () => { const path = await api.backup(backupPassword); setBackupPassword(''); setBackupPath(path); setMessage('加密备份已创建。'); })}>创建备份</button>
        {backupPath && <p className="small path" role="status">文件位置：{backupPath}</p>}
      </section>
    </div>
    <section className="card below"><h2>恢复加密备份</h2><p className="muted">先验证备份和密码并预览，再替换当前数据。请先保存当前库的备份。</p>
      <div className="form-actions left"><button className="button ghost" disabled={busy} onClick={() => void run(chooseBackup)}>选择 .mgb 文件</button>{restorePath && <span className="small path">{restorePath}</span>}</div>
      {restorePath && <><label className="field">备份密码<input type="password" autoComplete="off" value={restorePassword} onChange={(e) => { setRestorePassword(e.target.value); setPreview(null); }} /></label>
        <div className="form-actions left"><button className="button ghost" disabled={busy || !restorePassword} onClick={() => void run(async () => { setPreview(await api.previewRestore(restorePath, restorePassword)); setMessage('备份验证通过，可确认恢复。'); })}>验证并预览</button></div>
      </>}
      {preview && <div className="quiet-box"><p>备份创建于：{new Date(preview.createdAt * 1000).toLocaleString('zh-CN')}</p><p>包含目标：{preview.goalCount} 项</p>
        <button className="button primary" disabled={busy} onClick={() => void run(async () => { const next = await api.restore(restorePath, restorePassword); onStatus(next); onGoals(await api.goals()); setRestorePassword(''); setPreview(null); setMessage('备份已恢复。'); })}>确认替换当前数据</button>
      </div>}
    </section>
    <p className="small muted below">无账号 · 无云同步 · 无遥测。记录、日记和浏览器扩展尚未开放。</p>
    {message && <p role="status" className="message">{message}</p>}
    {error && <p role="alert" className="message error">{error}</p>}
  </>;
}
