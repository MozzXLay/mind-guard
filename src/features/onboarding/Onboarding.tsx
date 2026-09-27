import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorText, type VaultStatus } from '../../app/api';

const options = ['减少色情内容浏览', '减少深夜使用', '观察冲动和触发因素'];

type Props = { onCreated: (status: VaultStatus) => void; onRestore: () => void };

export default function Onboarding({ onCreated, onRestore }: Props) {
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState<string[]>([]);
  const [custom, setCustom] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { if (step > 0) heading.current?.focus(); }, [step]);

  function toggle(goal: string) {
    setChosen((current) => current.includes(goal) ? current.filter((x) => x !== goal) : [...current, goal]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (step < 2) { setStep(step + 1); return; }
    if ([...password].length < 12) { setError('主密码至少需要 12 个字符。'); return; }
    if (password !== confirm) { setError('两次输入的密码不一致。'); return; }
    const goals = [...chosen, ...(custom.trim() ? [custom.trim()] : [])];
    setBusy(true);
    try {
      const status = await api.initialize(password, goals);
      setPassword('');
      setConfirm('');
      onCreated(status);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-screen">
    <form className="auth-panel" onSubmit={submit}>
      <div className="brand"><span className="brandmark" aria-hidden="true" />净界</div>
      <p className="kicker">首次引导 · {step + 1} / 3</p>
      <div className="progress" aria-label={`第 ${step + 1} 步，共 3 步`}><span style={{ width: `${(step + 1) / 3 * 100}%` }} /></div>
      {step === 0 && <section>
        <h1 ref={heading} tabIndex={-1}>留一处安静的空间。</h1>
        <p>观察自己的习惯，想暂停时有个入口。内容只保存在这台设备上，无需账号。</p>
        <div className="quiet-box"><strong>先由你决定记录什么。</strong><p>这里不诊断，也不会替你定义“失败”。</p></div>
      </section>}
      {step === 1 && <section>
        <h1 ref={heading} tabIndex={-1}>你想改变什么？</h1>
        <p>可以多选，也可以稍后再设置。自慰不自动算作失败。</p>
        {options.map((goal) => <label className="checkrow" key={goal}>
          <input type="checkbox" checked={chosen.includes(goal)} onChange={() => toggle(goal)} />
          <span>{goal}</span>
        </label>)}
        <label className="field">自定义目标（可选）<input maxLength={100} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="例如：睡前少看一会儿屏幕" /></label>
      </section>}
      {step === 2 && <section>
        <h1 ref={heading} tabIndex={-1}>保护你的记录。</h1>
        <p>主密码用于解锁本地加密数据。密码丢失后，旧数据和备份无法恢复。</p>
        <label className="field">设置主密码<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={12} maxLength={1024} /></label>
        <label className="field">再次输入主密码<input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} minLength={12} maxLength={1024} /></label>
        <label className="checkrow"><input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} /><span>显示密码</span></label>
        <p className="small muted">建议使用独特且能记住的长密码，至少 12 个字符。没有找回服务。</p>
      </section>}
      {error && <p className="message error" role="alert">{error}</p>}
      <div className="form-actions">
        {step > 0 && <button type="button" className="button ghost" onClick={() => { setError(''); setStep(step - 1); }}>上一步</button>}
        <button className="button primary" disabled={busy}>{busy ? '正在创建加密存储…' : step === 2 ? '创建并进入今日' : '下一步'}</button>
      </div>
      {step === 0 && <button type="button" className="text-button" onClick={onRestore}>已有加密备份？在此恢复</button>}
    </form>
  </main>;
}
