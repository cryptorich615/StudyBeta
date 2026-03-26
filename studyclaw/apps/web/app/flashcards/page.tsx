"use client";

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

type FlashcardSet = {
  id: string;
  title: string;
  description?: string;
  card_count: number;
  created_at: string;
};

export default function FlashcardsPage() {
  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/study-tools/flashcard-sets')
      .then(r => r.ok ? r.json() : { sets: [] })
      .then(d => setSets(d.sets || d || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Flashcard Sets</h1>
          <p className="text-zinc-400">Review and study your flashcard sets.</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
          </div>
        ) : sets.length === 0 ? (
          <div className="text-center py-16 border border-zinc-800 rounded-xl">
            <div className="text-5xl mb-4">📚</div>
            <p className="text-zinc-400 text-lg mb-2">No flashcard sets yet</p>
            <p className="text-zinc-500 text-sm">Ask your agent in <a href="/chat" className="text-amber-400 hover:underline">Chat</a> to create a flashcard set from your notes.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sets.map(s => (
              <div key={s.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors cursor-pointer">
                <h3 className="font-semibold text-white text-lg">{s.title}</h3>
                {s.description && <p className="text-zinc-400 text-sm mt-1">{s.description}</p>}
                <p className="text-amber-400 text-sm mt-3">{s.card_count} cards</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}