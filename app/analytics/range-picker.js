'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useTransition } from 'react';
import DateField from '../../components/date-field';

export default function RangePicker({ from, to }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);

  useEffect(() => {
    setLocalFrom(from);
    setLocalTo(to);
  }, [from, to]);

  const go = (f, t) => {
    setLocalFrom(f);
    setLocalTo(t);
    startTransition(() => {
      router.push(`/analytics?from=${f}&to=${t}`);
    });
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 150 }}>
        <DateField
          type="month"
          value={localFrom}
          max={localTo}
          loading={isPending}
          onChange={(v) => go(v, localTo)}
        />
      </div>
      <span className="muted" style={{ fontSize: 13 }}>ถึง</span>
      <div style={{ minWidth: 150 }}>
        <DateField
          type="month"
          value={localTo}
          min={localFrom}
          loading={isPending}
          onChange={(v) => go(localFrom, v)}
        />
      </div>
    </div>
  );
}
