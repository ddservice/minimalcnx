'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import ExpenseForm from './expense-form';
import ExpenseList from './expense-list';
import AccessBanner from '../../components/access-banner';
import DateField from '../../components/date-field';

export default function ExpensesClient({ date, initialCategory, allExisting, catalog, access = {}, canDelete = false }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [category, setCategory] = useState(initialCategory);

  const catForCat = catalog.filter((c) => c.category === category);

  function navDate(nextDate) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) {
      startTransition(() => {
        router.push(`/expenses?date=${nextDate}&category=${encodeURIComponent(category)}`);
      });
    }
  }

  return (
    <>
      {access.create ? (
        <ExpenseForm key={category} date={date} category={category} onCategory={setCategory} catalog={catForCat} />
      ) : (
        <>
          <AccessBanner level={access.level || 'view'} />
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-body">
              <label className="muted" style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>วันที่</label>
              <DateField value={date} loading={isPending} onChange={navDate} />
            </div>
          </div>
        </>
      )}
      <ExpenseList rows={allExisting} date={date} canEdit={!!access.edit} canDelete={canDelete} />
    </>
  );
}
