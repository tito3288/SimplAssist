'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Pencil, Trash2, Plus, ChevronUp } from 'lucide-react';
import type { Service } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { primaryCtaCompactClass } from '@/lib/glass';

interface ServicesManagerProps {
  businessId: string;
  initialServices: Service[];
}

export default function ServicesManager({ businessId, initialServices }: ServicesManagerProps) {
  const [services, setServices] = useState<Service[]>(initialServices);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPrice, setNewPrice] = useState('');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPrice, setEditPrice] = useState('');

  const supabase = createClient();

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setSaving('add');
    try {
      const { data, error } = await supabase
        .from('services')
        .insert({
          business_id: businessId,
          name: newName.trim(),
          description: newDescription.trim() || null,
          price: newPrice.trim() || null,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      setServices((prev) => [...prev, data]);
      setNewName('');
      setNewDescription('');
      setNewPrice('');
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
        .from('services')
        .update({
          name: editName.trim(),
          description: editDescription.trim() || null,
          price: editPrice.trim() || null,
        })
        .eq('id', id);
      if (error) throw error;
      setServices((prev) =>
        prev.map((s) =>
          s.id === id ? { ...s, name: editName.trim(), description: editDescription.trim() || null, price: editPrice.trim() || null } : s
        )
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
      const { error } = await supabase.from('services').update({ is_active: !isActive }).eq('id', id);
      if (error) throw error;
      setServices((prev) => prev.map((s) => (s.id === id ? { ...s, is_active: !isActive } : s)));
    } catch {
      // Handle silently
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(id);
    try {
      const { error } = await supabase.from('services').delete().eq('id', id);
      if (error) throw error;
      setServices((prev) => prev.filter((s) => s.id !== id));
      setDeleteConfirmId(null);
    } catch {
      // Handle silently
    } finally {
      setSaving(null);
    }
  };

  const startEdit = (service: Service) => {
    setEditName(service.name);
    setEditDescription(service.description || '');
    setEditPrice(service.price || '');
    setExpandedId(service.id);
  };

  return (
    <div className="space-y-4">
      {services.length === 0 && !showAddForm && (
        <p className="text-sm text-slate-500 dark:text-[#bdbdbf] text-center py-4">No services yet. Add your first service below.</p>
      )}

      <div className="space-y-2">
        {services.map((service) => (
          <div key={service.id} className="border border-slate-200 dark:border-white/[0.12] rounded-lg">
            <div className="flex items-center gap-3 p-3">
              <button
                type="button"
                onClick={() => handleToggleActive(service.id, service.is_active)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                  service.is_active ? 'bg-[#ff914d]' : 'bg-gray-300 dark:bg-white/[0.12]'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                    service.is_active ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>

              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${service.is_active ? 'text-slate-900 dark:text-[#f5f5f5]' : 'text-slate-400 dark:text-[#666]'}`}>
                  {service.name}
                </p>
                {service.description && (
                  <p className="text-xs text-slate-500 dark:text-[#bdbdbf] truncate">{service.description}</p>
                )}
              </div>

              {service.price && (
                <span className="text-sm text-slate-600 dark:text-[#bdbdbf] shrink-0">{service.price}</span>
              )}

              <button
                type="button"
                onClick={() => (expandedId === service.id ? setExpandedId(null) : startEdit(service))}
                className="text-slate-400 dark:text-[#bdbdbf] hover:text-[#ff914d] p-1"
              >
                {expandedId === service.id ? <ChevronUp className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
              </button>

              {deleteConfirmId === service.id ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleDelete(service.id)}
                    disabled={saving === service.id}
                    className="text-xs text-red-600 hover:text-red-700 font-medium"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirmId(null)}
                    className="text-xs text-slate-500 dark:text-[#bdbdbf] hover:text-slate-700 dark:hover:text-[#f5f5f5]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(service.id)}
                  className="text-slate-400 dark:text-[#bdbdbf] hover:text-red-500 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {expandedId === service.id && (
              <div className="border-t border-slate-200 dark:border-white/[0.10] p-3 space-y-2 bg-slate-50 dark:bg-white/[0.03]">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Service name"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg text-sm bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d]"
                />
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg text-sm bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d]"
                />
                <input
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  placeholder="Price (optional)"
                  className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg text-sm bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d]"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(null)}
                    className="px-3 py-1.5 text-sm text-slate-600 dark:text-[#bdbdbf] hover:text-slate-800 dark:hover:text-[#f5f5f5]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEdit(service.id)}
                    disabled={saving === service.id || !editName.trim()}
                    className={primaryCtaCompactClass}
                  >
                    {saving === service.id ? (
                      <>
                        <PulsingDot inline />
                        Saving…
                      </>
                    ) : (
                      'Save'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showAddForm ? (
        <div className="border border-[#ff914d]/40 dark:border-[#ff914d]/30 rounded-lg p-3 space-y-2 bg-orange-50 dark:bg-white/[0.04]">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Service name *"
            className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg text-sm bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d]"
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg text-sm bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d]"
          />
          <input
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="Price (optional)"
            className="w-full px-3 py-2 border border-gray-300 dark:border-white/[0.12] rounded-lg text-sm bg-white dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:outline-none focus:ring-2 focus:ring-[#ff914d] focus:border-[#ff914d]"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setNewName(''); setNewDescription(''); setNewPrice(''); }}
              className="px-3 py-1.5 text-sm text-slate-600 dark:text-[#bdbdbf] hover:text-slate-800 dark:hover:text-[#f5f5f5]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving === 'add' || !newName.trim()}
              className={primaryCtaCompactClass}
            >
              {saving === 'add' ? (
                <>
                  <PulsingDot inline />
                  Adding…
                </>
              ) : (
                'Add Service'
              )}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1 text-sm text-[#ff914d] hover:text-[#e07a3a] font-medium"
        >
          <Plus className="w-4 h-4" /> Add Service
        </button>
      )}
    </div>
  );
}
