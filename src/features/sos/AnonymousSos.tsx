import { useEffect, useState } from 'react';

type Props = { onLeave: () => void; standalone?: boolean };

export default function AnonymousSos({ onLeave, standalone = false }: Props) {
  const [seconds, setSeconds] = useState(90);
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running || seconds === 0) return;
    const timer = window.setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [running, seconds]);
  const time = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const Root = standalone ? 'main' : 'section';
  return <Root className="auth-screen"><section className="auth-panel sos-panel">
    <p className="kicker">PAUSE / 无需记录</p>
    <h1>现在先缓一缓。</h1>
    <p>跟随自己的节奏呼吸，也可以跳过。此练习不读取或保存个人记录。</p>
    <div className={`breath ${running ? 'live' : ''}`} aria-label={`剩余 ${time}`}><span>{time}</span></div>
    <div className="form-actions">
      {seconds > 0 && <button className="button primary" onClick={() => setRunning(!running)}>{running ? '暂停' : seconds === 90 ? '开始 90 秒' : '继续'}</button>}
      <button className="button ghost" onClick={() => { setSeconds(0); setRunning(false); }}>跳过</button>
      <button className="button ghost" onClick={onLeave}>结束并离开</button>
    </div>
    {seconds === 0 && <p className="message">可以喝点水、离开屏幕，或者直接回到刚才的事。</p>}
  </section></Root>;
}
