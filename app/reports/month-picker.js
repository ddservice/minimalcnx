'use client';

import { useRouter } from 'next/navigation';
import { useState, useEffect, useTransition } from 'react';
import DateField from '../../components/date-field';

export default function MonthPicker({ value }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [localVal, setLocalVal] = useState(value);

  useEffect(() => {
    setLocalVal(value);
  }, [value]);

  const handleChange = (v) => {
    if (/^\d{4}-\d{2}$/.test(v) && v !== localVal) {
      setLocalVal(v);
      startTransition(() => {
        router.push(`/reports?month=${v}`);
      });
    }
  };

  return (
    <div style={{ minWidth: 160 }}>
      <DateField
        type="month"
        value={localVal}
        loading={isPending}
        onChange={handleChange}
      />
    </div>
  );
}
