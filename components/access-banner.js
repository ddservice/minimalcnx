import Icon from './icon';
import { ACCESS_HINT } from '../lib/perms';

export default function AccessBanner({ level, extra }) {
  if (level === 'edit' || !level) return null;
  const text = extra || ACCESS_HINT[level] || ACCESS_HINT.view;
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '10px 12px',
        marginBottom: 12,
        borderRadius: 'var(--radius-md)',
        background: 'var(--color-info-bg)',
        color: 'var(--color-info)',
        fontSize: 'var(--fs-base)',
        fontWeight: 600,
      }}
    >
      <Icon name="ti-alert-circle" />
      <span>{text}</span>
    </div>
  );
}
