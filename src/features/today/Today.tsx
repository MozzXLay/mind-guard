type Props = { goals: string[]; onSos: () => void };

export default function Today({ goals, onSos }: Props) {
  const today = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full' }).format(new Date());
  return <div>
    <p className="kicker">TODAY / 01</p>
    <h1 className="page-title">今晚，先照顾好自己。</h1>
    <p className="subtitle">这是一处安静的空间。可以观察，也可以先休息。</p>
    <div className="card-grid">
      <section className="card hero">
        <p className="kicker">你的方向</p>
        <h2>{goals.length ? '把冲动与行动之间，留出一点空间。' : '今天先做一件小事。'}</h2>
        <p>{goals.length ? '目标由你选择，随时可以调整节奏。' : '目前还没有目标。你也可以先停一会儿。'}</p>
        <button className="button primary" onClick={onSos}>开始无需记录的 SOS</button>
      </section>
      <section className="card">
        <div className="row-between"><h2>近 7 天概览</h2><span className="pill">尚无记录</span></div>
        <div className="empty-number">0 / 7</div>
        <p className="muted">有记录的日子。记录功能将在 M1 开放；这里不会展示演示数据。</p>
      </section>
    </div>
    <div className="card-grid below">
      <section className="card"><h2>当前目标</h2>{goals.length ? <ul className="goal-list">{goals.map((goal) => <li key={goal}>{goal}</li>)}</ul> : <p className="muted">首次引导选择目标是可选的。</p>}</section>
      <section className="card"><h2>最近的观察</h2><p className="muted">还没有记录。M1 会提供快速记录、编辑和回顾。</p><span className="pill">空态 · {today}</span></section>
    </div>
  </div>;
}
