"use client";

type PaidAccessBenefitsProps = {
  className?: string;
};

export function PaidAccessBenefits({ className = "" }: PaidAccessBenefitsProps) {
  return (
    <div className={`text-left ${className}`}>
      <p className="m-0 text-sm font-black text-slate-950">Поддержите автора канала:</p>
      <ul className="m-0 mt-2 space-y-2 p-0 text-sm leading-6 text-slate-700">
        <li className="flex gap-2">
          <span className="text-slate-400" aria-hidden="true">—</span>
          <span>Получите доступ ко всем разделам базы знаний</span>
        </li>
        <li className="flex gap-2">
          <span className="text-slate-400" aria-hidden="true">—</span>
          <span>Изучите инструменты, людей, тренды, инсайты, гипотезы и другие сигналы</span>
        </li>
        <li className="flex gap-2">
          <span className="text-slate-400" aria-hidden="true">—</span>
          <span>Получайте уведомления о новых знаниях</span>
        </li>
      </ul>
    </div>
  );
}
