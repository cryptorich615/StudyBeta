'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

type Reminder = {
  id: string;
  title: string;
  description?: string;
  remind_at: string;
  status: string;
  created_at: string;
};

export default function RemindersPage() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function loadReminders() {
      try {
        const res = await apiFetch('/api/reminders');
        if (res.ok) {
          const data = await res.json();
          setReminders(data.reminders || data || []);
        } else {
          setError('Failed to load reminders.');
        }
      } catch (e) {
        setError('Connection error.');
      } finally {
        setLoading(false);
      }
    }
    loadReminders();
  }, []);

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Reminders</h1>
          <p className="text-zinc-400">All your upcoming reminders and scheduled tasks.</p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300">{error}</div>
        )}

        {!loading && !error && reminders.length === 0 && (
          <div className="text-center py-16 border border-zinc-800 rounded-xl">
            <div className="text-5xl mb-4">🔔</div>
            <p className="text-zinc-400 text-lg mb-2">No reminders yet</p>
            <p className="text-zinc-500 text-sm">Tell your agent to set a reminder in the <a href="/chat" className="text-amber-400 hover:underline">Chat</a>.</p>
          </div>
        )}

        {!loading && reminders.length > 0 && (
          <div className="space-y-3">
            {reminders.map((r) => (
              <div key={r.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 flex items-start justify-between hover:border-zinc-700 transition-colors">
                <div>
                  <p className="font-semibold text-white">{r.title}</p>
                  {r.description && <p className="text-zinc-400 text-sm mt-1">{r.description}</p>}
                  <p className="text-amber-400 text-sm mt-2">🕐 {formatDate(r.remind_at)}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                  r.status === 'pending' ? 'bg-amber-900/40 text-amber-300' :
                  r.status === 'sent' ? 'bg-green-900/40 text-green-300' :
                  'bg-zinc-800 text-zinc-400'
                }`}>{r.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
