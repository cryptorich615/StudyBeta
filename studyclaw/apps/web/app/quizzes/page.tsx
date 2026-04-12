"use client";

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

type Quiz = {
  id: string;
  title: string;
  description?: string;
  question_count: number;
  created_at: string;
  score?: number;
};

export default function QuizzesPage() {
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/study-tools/quizzes')
      .then(r => r.ok ? r.json() : { quizzes: [] })
      .then(d => setQuizzes(d.quizzes || d || []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white p-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Quizzes</h1>
          <p className="text-zinc-400">Test your knowledge with AI-generated quizzes.</p>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
          </div>
        ) : quizzes.length === 0 ? (
          <div className="text-center py-16 border border-zinc-800 rounded-xl">
            <div className="text-5xl mb-4">🧠</div>
            <p className="text-zinc-400 text-lg mb-2">No quizzes yet</p>
            <p className="text-zinc-500 text-sm">Ask your agent in <a href="/chat" className="text-amber-400 hover:underline">Chat</a> to create a quiz from your notes.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {quizzes.map(q => (
              <div key={q.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 hover:border-zinc-700 transition-colors cursor-pointer">
                <h3 className="font-semibold text-white text-lg">{q.title}</h3>
                {q.description && <p className="text-zinc-400 text-sm mt-1">{q.description}</p>}
                <div className="flex items-center justify-between mt-3">
                  <p className="text-amber-400 text-sm">{q.question_count} questions</p>
                  {q.score !== undefined && <span className="text-green-400 text-sm font-medium">{q.score}%</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
