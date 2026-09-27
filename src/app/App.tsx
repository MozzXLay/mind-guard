import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { api, errorText, type RestorePreview, type VaultStatus } from './api';
import Onboarding from '../features/onboarding/Onboarding';
import Today from '../features/today/Today';
import AnonymousSos from '../features/sos/AnonymousSos';
import Records from '../features/records/Records';
import Plan from '../features/plan/Plan';
import SavedSos from '../features/sos/SavedSos';

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
  const [startupError, setStartupError] = useState('');
  const [anonymousSos, setAnonymousSos] = useState(false);
  const [theme, setTheme] = useTheme();
  const lastTouch = useRef(performance.now());

  const refresh = useCallback(async () => {
    try {
      const next = await api.status();
      setStatus(next);
      setStartupError('');
    } catch (cause) {
      setStartupError(errorText(cause));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const lock = useCallback(async () => {
    setStatus((current) => current ? { ...current, unlocked: false } : current);
    try { setStatus(await api.lock()); }
    catch (cause) { setStartupError(errorText(cause)); }
  }, []);

  useEffect(() => {
    if (!status?.unlocked) return;
    const timeout = status.autoLockMinutes * 60 * 1000;
    let lastInput = performance.now();
    let lastWall = Date.now();
    const onInput = () => {
      lastInput = performance.now();
      lastWall = Date.now();
      if (lastInput - lastTouch.current > 30_000) {
        lastTouch.current = lastInput;
        void api.touch().catch(() => void lock());
      }
    };
    const resume = () => {
      const wallGap = Date.now() - lastWall;
      if (performance.now() - lastInput >= timeout || wallGap >= timeout || wallGap < -1000) {
        void lock();
        return;
      }
      setStatus((current) => current ? { ...current, unlocked: false } : current);
      void refresh();
    };
    const onVisibility = () => {
      if (document.hidden) void lock();
      else resume();
    };
    const onFocus = () => { if (!document.hidden) resume(); };
    const interval = window.setInterval(() => {
      const wallGap = Date.now() - lastWall;
      if (performance.now() - lastInput >= timeout || wallGap >= timeout || wallGap < -1000) void lock();
    }, 5000);
    for (const event of ['keydown', 'pointerdown', 'pointermove', 'touchstart']) window.addEventListener(event, onInput, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      for (const event of ['keydown', 'pointerdown', 'pointermove', 'touchstart']) window.removeEventListener(event, onInput);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
    };
  }, [status?.unlocked, status?.autoLockMinutes, lock, refresh]);

  if (startupError && !status) return <main className="auth-screen"><section className="auth-panel">
    <h1>本地存储尚未就绪</h1><p role="alert">{startupError}</p>
    <button className="button primary" onClick={() => void refresh()}>重试</button>
  </section></main>;
  if (!status) return <main className="auth-screen"><p role="status">正在打开本地空间…</p></main>;
  if (!status.initialized) return <Onboarding onCreated={(next) => { setStatus(next); void refresh(); }} />;
  if (status.recoveryRequired) return <RecoveryScreen onRestored={(next) => { setStatus(next); void refresh(); }} />;
  if (anonymousSos) return <AnonymousSos standalone onLeave={() => setAnonymousSos(false)} />;
  if (!status.unlocked) return <LockScreen onUnlocked={(next) => { setStatus(next); void refresh(); }} onSos={() => setAnonymousSos(true)} />;

  return <HashRouter><Shell status={status} theme={theme} setTheme={setTheme} onLock={lock} onStatus={setStatus} /></HashRouter>;
}

function LockScreen({ onUnlocked, onSos }: { onUnlocked: (status: VaultStatus) => void; onSos: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { const next = await api.unlock(password); setPassword(''); onUnlocked(next); }
    catch (cause) { setError(errorText(cause)); setPassword(''); }
    finally { setBusy(false); }
  }
  if (showRestore) return <RecoveryScreen onRestored={onUnlocked} onCancel={() => setShowRestore(false)} />;
  return <main className="auth-screen"><form className="auth-panel lock-panel" onSubmit={submit}>
    <span className="brandmark" aria-hidden="true" /><h1>欢迎回来。</h1>
    <p>你的本地空间已锁定。输入主密码后继续。</p>
    <label className="field">主密码<input autoFocus type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
    {error && <p role="alert" className="message error">{error}</p>}
    <div className="form-actions"><button className="button primary" disabled={busy || !password}>{busy ? '正在验证…' : '解锁'}</button><button type="button" className="button ghost" onClick={onSos}>无需记录的 SOS</button></div>
    <button type="button" className="text-button" aria-expanded={showHelp} onClick={() => setShowHelp(!showHelp)}>忘记密码？</button>
    <button type="button" className="text-button" onClick={() => setShowRestore(true)}>从加密备份恢复</button>
    {showHelp && <p className="small muted">没有服务端恢复。遗失主密码后，旧数据库和备份无法解锁。新建空库会舍弃旧数据，请先保留原始文件以便将来想起密码时重试。</p>}
  </form></main>;
}

function RecoveryScreen({ onRestored, onCancel }: { onRestored: (status: VaultStatus) => void; onCancel?: () => void }) {
  const [path, setPath] = useState('');
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function choose() {
    try {
      const chosen = await open({ multiple: false, directory: false, filters: [{ name: '净界加密备份', extensions: ['mgb'] }] });
      if (typeof chosen === 'string') { setPath(chosen); setPreview(null); }
    } catch (cause) { setError(errorText(cause)); }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError('');
    try { await action(); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }
  return <main className="auth-screen"><section className="auth-panel lock-panel">
    <h1>从加密备份恢复</h1>
    <p>可在未解锁、全新安装或当前库损坏时恢复。先用备份密码验证文件；替换前会保留当前密文库与密钥清单的私有副本。</p>
    <button className="button ghost" disabled={busy} onClick={() => void choose()}>选择 .mgb 文件</button>
    {path && <><p className="small path">{path}</p><label className="field">备份密码<input type="password" autoComplete="off" value={password} onChange={(e) => { setPassword(e.target.value); setPreview(null); }} /></label>
      <button className="button ghost" disabled={busy || !password} onClick={() => void run(async () => { setPreview(await api.previewRestore(path, password)); })}>验证并预览</button></>}
    {preview && <div className="quiet-box"><p>备份创建于：{new Date(preview.createdAt * 1000).toLocaleString('zh-CN')}</p><p>包含目标：{preview.goalCount} 项</p>
      <button className="button primary" disabled={busy} onClick={() => void run(async () => { const next = await api.restore(path, password); setPassword(''); onRestored(next); })}>确认恢复</button></div>}
    {onCancel && <button className="button ghost" disabled={busy} onClick={onCancel}>返回解锁</button>}
    {error && <p className="message error" role="alert">{error}</p>}
  </section></main>;
}

type ShellProps = {
  status: VaultStatus; theme: string;
  setTheme: (theme: string) => void; onLock: () => void;
  onStatus: (status: VaultStatus) => void;
};

export function Shell({ status, theme, setTheme, onLock, onStatus }: ShellProps) {
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
          <Route path="/today" element={<Today onSos={() => navigate('/sos')} onRecord={() => navigate('/records')} onPlan={() => navigate('/plan')} />} />
          <Route path="/sos" element={<SavedSos onLeave={() => navigate('/today')} />} />
          <Route path="/records" element={<Records />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/insights" element={<ComingSoon title="把规律看清一点。" detail="7/30 天统计将在 M1 从真实记录计算。当前没有样本，不作趋势判断。" />} />
          <Route path="/journal" element={<ComingSoon title="写给自己的几句话。" detail="日记将在 M1 开放；当前没有日记输入或明文暂存。" />} />
          <Route path="/blocker" element={<ComingSoon title="降低访问的便利性。" detail="浏览器扩展属于 M2。Firefox 与 Chromium 均未连接，当前没有规则生效。" />} />
          <Route path="/settings" element={<Settings status={status} theme={theme} setTheme={setTheme} onStatus={onStatus} />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </div>
    </main>
  </div>;
}

function ComingSoon({ title, detail }: { title: string; detail: string }) {
  return <><p className="kicker">阶段状态</p><h1 className="page-title">{title}</h1><section className="card coming-soon"><span className="pill">后续里程碑</span><h2>此功能尚未开放</h2><p className="muted">{detail}</p></section></>;
}

function Settings({ status, theme, setTheme, onStatus }: {
  status: VaultStatus; theme: string; setTheme: (theme: string) => void;
  onStatus: (status: VaultStatus) => void;
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
        <button className="button primary" disabled={busy} onClick={() => void run(async () => { const next = await api.restore(restorePath, restorePassword); onStatus(next); setRestorePassword(''); setPreview(null); setMessage('备份已恢复。'); })}>确认替换当前数据</button>
      </div>}
    </section>
    <p className="small muted below">无账号 · 无云同步 · 无遥测。记录、日记和浏览器扩展尚未开放。</p>
    {message && <p role="status" className="message">{message}</p>}
    {error && <p role="alert" className="message error">{error}</p>}
  </>;
}
