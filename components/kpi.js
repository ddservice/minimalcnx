import Icon from './icon';
export default function Kpi({ icon, label, value, sub, cls, plain }) {
  return (
    <div className="kpi">
      <div className={`kpi-icon${!plain && cls ? ` ${cls}` : ''}`}><Icon name={icon} /></div>
      <div className="kpi-body">
        <div className="kpi-label">{label}</div>
        <div className={`kpi-val${!plain && cls ? ` ${cls}` : ''}`} style={plain ? { fontSize: 'var(--fs-3xl)' } : undefined}>{value}</div>
        {sub ? <div className="kpi-sub">{sub}</div> : null}
      </div>
    </div>
  );
}
