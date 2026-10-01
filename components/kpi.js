import Icon from './icon';
// delta: { text, tone: 'good'|'bad'|'flat' } — บรรทัดเทียบช่วงก่อนหน้า (ไม่ส่ง = ไม่แสดง)
export default function Kpi({ icon, label, value, sub, cls, plain, delta }) {
  return (
    <div className="kpi">
      <div className={`kpi-icon${!plain && cls ? ` ${cls}` : ''}`}><Icon name={icon} /></div>
      <div className="kpi-body">
        <div className="kpi-label">{label}</div>
        <div className={`kpi-val${!plain && cls ? ` ${cls}` : ''}`} style={plain ? { fontSize: 'var(--fs-3xl)' } : undefined}>{value}</div>
        {sub ? <div className="kpi-sub">{sub}</div> : null}
        {delta ? <div className={`kpi-delta ${delta.tone}`}>{delta.text}</div> : null}
      </div>
    </div>
  );
}
