'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Pencil, Trash2, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import type { Service } from '@/types/database';

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
        <p className="text-sm text-gray-500 text-center py-4">No services yet. Add your first service below.</p>
      )}

      <div className="space-y-2">
        {services.map((service) => (
          <div key={service.id} className="border border-gray-200 rounded-lg">
            <div className="flex items-center gap-3 p-3">
              <button
                type="button"
                onClick={() => handleToggleActive(service.id, service.is_active)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                  service.is_active ? 'bg-blue-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                    service.is_active ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>

              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${service.is_active ? 'text-gray-900' : 'text-gray-400'}`}>
                  {service.name}
                </p>
                {service.description && (
                  <p className="text-xs text-gray-500 truncate">{service.description}</p>
                )}
              </div>

              {service.price && (
                <span className="text-sm text-gray-600 shrink-0">{service.price}</span>
              )}

              <button
                type="button"
                onClick={() => (expandedId === service.id ? setExpandedId(null) : startEdit(service))}
                className="text-gray-400 hover:text-blue-600 p-1"
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
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(service.id)}
                  className="text-gray-400 hover:text-red-500 p-1"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {expandedId === service.id && (
              <div className="border-t border-gray-200 p-3 space-y-2 bg-gray-50">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Service name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  placeholder="Price (optional)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                    onClick={() => handleEdit(service.id)}
                    disabled={saving === service.id || !editName.trim()}
                    className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving === service.id ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showAddForm ? (
        <div className="border border-blue-200 rounded-lg p-3 space-y-2 bg-blue-50">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Service name *"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <input
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="Price (optional)"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setNewName(''); setNewDescription(''); setNewPrice(''); }}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving === 'add' || !newName.trim()}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving === 'add' ? 'Adding...' : 'Add Service'}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
        >
          <Plus className="w-4 h-4" /> Add Service
        </button>
      )}
    </div>
  );
}
