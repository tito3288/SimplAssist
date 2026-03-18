'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Pencil, Trash2, Plus, ChevronUp } from 'lucide-react';
import type { FAQ } from '@/types/database';

interface FAQManagerProps {
  businessId: string;
  initialFaqs: FAQ[];
}

export default function FAQManager({ businessId, initialFaqs }: FAQManagerProps) {
  const [faqs, setFaqs] = useState<FAQ[]>(initialFaqs);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');

  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');

  const supabase = createClient();

  const sourceLabel = (source: string) => {
    switch (source) {
      case 'scraped': return { text: 'Scraped', color: 'bg-purple-100 text-purple-700' };
      case 'suggested': return { text: 'Suggested', color: 'bg-yellow-100 text-yellow-700' };
      default: return { text: 'Manual', color: 'bg-gray-100 text-gray-700' };
    }
  };

  const handleAdd = async () => {
    if (!newQuestion.trim() || !newAnswer.trim()) return;
    setSaving('add');
    try {
      const { data, error } = await supabase
        .from('faqs')
        .insert({
          business_id: businessId,
          question: newQuestion.trim(),
          answer: newAnswer.trim(),
          source: 'manual' as const,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      setFaqs((prev) => [...prev, data]);
      setNewQuestion('');
      setNewAnswer('');
      setShowAddForm(false);
    } catch {
      // Handle silently
    } finally {
      setSaving(null);
    }
  };

  const handleEdit = async (id: string) => {
    setSaving(id);
    try {
      const { error } = await supabase
        .from('faqs')
        .update({ question: editQuestion.trim(), answer: editAnswer.trim() })
        .eq('id', id);
      if (error) throw error;
      setFaqs((prev) =>
        prev.map((f) => (f.id === id ? { ...f, question: editQuestion.trim(), answer: editAnswer.trim() } : f))
      );
      setExpandedId(null);
    } catch {
      // Handle silently
    } finally {
      setSaving(null);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      const { error } = await supabase.from('faqs').update({ is_active: !isActive }).eq('id', id);
      if (error) throw error;
      setFaqs((prev) => prev.map((f) => (f.id === id ? { ...f, is_active: !isActive } : f)));
    } catch {
      // Handle silently
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(id);
    try {
      const { error } = await supabase.from('faqs').delete().eq('id', id);
      if (error) throw error;
      setFaqs((prev) => prev.filter((f) => f.id !== id));
      setDeleteConfirmId(null);
    } catch {
      // Handle silently
    } finally {
      setSaving(null);
    }
  };

  const startEdit = (faq: FAQ) => {
    setEditQuestion(faq.question);
    setEditAnswer(faq.answer);
    setExpandedId(faq.id);
  };

  return (
    <div className="space-y-4">
      {faqs.length === 0 && !showAddForm && (
        <p className="text-sm text-gray-500 text-center py-4">No FAQs yet. Add your first FAQ below.</p>
      )}

      <div className="space-y-2">
        {faqs.map((faq) => {
          const badge = sourceLabel(faq.source);
          return (
            <div key={faq.id} className="border border-gray-200 rounded-lg">
              <div className="flex items-start gap-3 p-3">
                <button
                  type="button"
                  onClick={() => handleToggleActive(faq.id, faq.is_active)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mt-0.5 ${
                    faq.is_active ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                      faq.is_active ? 'translate-x-5' : 'translate-x-1'
                    }`}
                  />
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${faq.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
                      {faq.question}
                    </p>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${badge.color}`}>
                      {badge.text}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{faq.answer}</p>
                </div>

                <button
                  type="button"
                  onClick={() => (expandedId === faq.id ? setExpandedId(null) : startEdit(faq))}
                  className="text-gray-400 hover:text-blue-600 p-1 shrink-0"
                >
                  {expandedId === faq.id ? <ChevronUp className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                </button>

                {deleteConfirmId === faq.id ? (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDelete(faq.id)}
                      disabled={saving === faq.id}
                      className="text-xs text-red-600 hover:text-red-700 font-medium"
                    >
                      Confirm
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteConfirmId(null)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(faq.id)}
                    className="text-gray-400 hover:text-red-500 p-1 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {expandedId === faq.id && (
                <div className="border-t border-gray-200 p-3 space-y-2 bg-gray-50">
                  <input
                    value={editQuestion}
                    onChange={(e) => setEditQuestion(e.target.value)}
                    placeholder="Question"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <textarea
                    value={editAnswer}
                    onChange={(e) => setEditAnswer(e.target.value)}
                    placeholder="Answer"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId(null)}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleEdit(faq.id)}
                      disabled={saving === faq.id || !editQuestion.trim() || !editAnswer.trim()}
                      className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {saving === faq.id ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showAddForm ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
          <input
            value={newQuestion}
            onChange={(e) => setNewQuestion(e.target.value)}
            placeholder="Question *"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <textarea
            value={newAnswer}
            onChange={(e) => setNewAnswer(e.target.value)}
            placeholder="Answer *"
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setNewQuestion(''); setNewAnswer(''); }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving === 'add' || !newQuestion.trim() || !newAnswer.trim()}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving === 'add' ? 'Adding...' : 'Add FAQ'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          <Plus className="w-4 h-4" /> Add FAQ
        </button>
      )}
    </div>
  );
}
