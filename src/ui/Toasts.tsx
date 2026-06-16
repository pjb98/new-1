import { useEffect, useState } from 'react';
import { bus } from '../game/EventBus';

type Toast = { id: number; msg: string };

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    let nextId = 0;
    return bus.on('toast', (msg) => {
      const toast = { id: nextId++, msg };
      setToasts((cur) => [...cur, toast]);
      setTimeout(() => {
        setToasts((cur) => cur.filter((t) => t.id !== toast.id));
      }, 2500);
    });
  }, []);

  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.msg}
        </div>
      ))}
    </div>
  );
}
