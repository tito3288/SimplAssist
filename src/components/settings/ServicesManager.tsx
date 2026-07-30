'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Pencil, Trash2, Plus, ChevronUp } from 'lucide-react';
import type { Service } from '@/types/database';
import { PulsingDot } from '@/components/ui/pulsing-dot';
import { primaryCtaCompactClass } from '@/lib/glass';
import {
  MIN_VALID_SERVICES,
  evaluateContentQuality,
  normalizeKnowledgeKey,
} from '@/lib/contentQuality';

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
  // Scoped to the acting control ('add' or a service id) so the message
  // renders where the user is looking, not off-viewport atop a long list.
  const [actionError, setActionError] = useState<{ scope: string; message: string } | null>(null);

  // Add form state
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newPrice, setNewPrice] = useState('');

  // Edit form state
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPrice, setEditPrice] = useState('');

  const supabase = createClient();
  const validServiceCount = evaluateContentQuality(services, []).validServiceCount;
  const serviceFloor = Math.min(validServiceCount, MIN_VALID_SERVICES);

  const projectedServiceCount = (nextServices: Service[]) =>
    evaluateContentQuality(nextServices, []).validServiceCount;

  const canRemoveActiveContribution = (id: string, mode: 'delete' | 'deactivate') => {
    const nextServices =
      mode === 'delete'
        ? services.filter((service) => service.id !== id)
        : services.map((service) =>
            service.id === id ? { ...service, is_active: false } : service
          );
    return projectedServiceCount(nextServices) >= serviceFloor;
  };

  const duplicatesActiveName = (name: string, excludeId?: string) => {
    const key = normalizeKnowledgeKey(name);
    return (
      key.length > 0 &&
      services.some(
        (service) =>
          service.id !== excludeId &&
          service.is_active &&
          normalizeKnowledgeKey(service.name) === key
      )
    );
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    if (duplicatesActiveName(newName)) {
      setActionError({ scope: 'add', message: 'Use a distinct service name. This service is already active.' });
      return;
    }
    setSaving('add');
    setActionError(null);
    try {
      const { data, error } = await supabase
        .from('services')
        .insert({
          business_id: businessId,
          name: newName.trim(),
          description: newDescription.trim() || null,
          price: newPrice.trim() || null,
          source: 'manual' as const,
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
      setActionError({ scope: 'add', message: 'Could not add the service. Please try again.' });
    } finally {
      setSaving(null);
    }
  };

  const handleEdit = async (id: string) => {
    const service = services.find((item) => item.id === id);
    if (!editName.trim()) {
      setActionError({ scope: id, message: 'Service name is required.' });
      return;
    }
    if (service?.is_active && duplicatesActiveName(editName, id)) {
      setActionError({ scope: id, message: 'Use a distinct service name. This service is already active.' });
      return;
    }
    setSaving(id);
    setActionError(null);
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
      setActionError({ scope: id, message: 'Could not save the service. Please try again.' });
    } finally {
      setSaving(null);
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    setActionError(null);
    const service = services.find((item) => item.id === id);
    if (!service) return;
    if (isActive && !canRemoveActiveContribution(id, 'deactivate')) {
      setActionError({
        scope: id,
        message: `Keep at least ${MIN_VALID_SERVICES} distinct active services. Add another service before turning this one off.`,
      });
      return;
    }
    if (!isActive) {
      if (!service.name.trim()) {
        setActionError({ scope: id, message: 'Add a service name before activating this service.' });
        return;
      }
      if (duplicatesActiveName(service.name, id)) {
        setActionError({ scope: id, message: 'Rename this service before activating it; that name is already active.' });
        return;
      }
    }
    try {
      const { error } = await supabase.from('services').update({ is_active: !isActive }).eq('id', id);
      if (error) throw error;
      setServices((prev) => prev.map((s) => (s.id === id ? { ...s, is_active: !isActive } : s)));
    } catch {
      setActionError({ scope: id, message: 'Could not update the service. Please try again.' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!canRemoveActiveContribution(id, 'delete')) {
      setActionError({
        scope: id,
        message: `Keep at least ${MIN_VALID_SERVICES} distinct active services. Add another service before deleting this one.`,
      });
      setDeleteConfirmId(null);
      return;
    }
    setSaving(id);
    setActionError(null);
    try {
      const { error } = await supabase.from('services').delete().eq('id', id);
      if (error) throw error;
      setServices((prev) => prev.filter((s) => s.id !== id));
      setDeleteConfirmId(null);
    } catch {
      setActionError({ scope: id, message: 'Could not delete the service. Please try again.' });
    } finally {
      setSaving(null);
    }
  };

  const errorFor = (scope: string, className = '') =>
    actionError?.scope === scope ? (
      <p className={`text-sm text-red-600 dark:text-red-400 ${className}`}>{actionError.message}</p>
    ) : null;

  const startEdit = (service: Service) => {
    setEditName(service.name);
    setEditDescription(service.description || '');
    setEditPrice(service.price || '');
    setExpandedId(service.id);
  };

  return (
    <div className="space-y-4">
      <div
        role="status"
        aria-live="polite"
        className={`rounded-lg border px-3 py-2 text-sm ${
          validServiceCount >= MIN_VALID_SERVICES
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200'
            : 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100'
        }`}
      >
        <p className="font-medium">
          {validServiceCount} of {MIN_VALID_SERVICES} distinct active services
        </p>
        {validServiceCount < MIN_VALID_SERVICES && (
          <p className="mt-1 text-xs">
            Add {MIN_VALID_SERVICES - validServiceCount} more so your AI can answer customers accurately. Your current AI service stays live while you repair this.
          </p>
        )}
      </div>

      {/* Fallback for an error scoped to a row that no longer renders (e.g.
          a slow failing toggle racing a successful delete) — without this
          the failure would be silent again. */}
      {actionError && actionError.scope !== 'add' &&
        !services.some((s) => s.id === actionError.scope) &&
        errorFor(actionError.scope)}

      {services.length === 0 && !showAddForm && (
        <p className="text-sm text-stone-500 dark:text-[#bdbdbf] text-center py-4">No services yet. Add your first service below.</p>
      )}

      <div className="space-y-2">
        {services.map((service) => {
          const deactivateLocked =
            service.is_active &&
            !canRemoveActiveContribution(service.id, 'deactivate');
          const deleteLocked = !canRemoveActiveContribution(service.id, 'delete');
          const floorExplanation = `Keep at least ${MIN_VALID_SERVICES} distinct active services. Add another service first.`;

          return (
          <div key={service.id} className="border border-[#ece4d8] dark:border-white/[0.12] rounded-lg">
            <div className="flex items-center gap-3 p-3">
              <button
                type="button"
                role="switch"
                aria-checked={service.is_active}
                onClick={() => handleToggleActive(service.id, service.is_active)}
                disabled={deactivateLocked}
                title={deactivateLocked ? floorExplanation : undefined}
                aria-label={`${service.is_active ? 'Deactivate' : 'Activate'} ${service.name}`}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
                  service.is_active ? 'bg-[#ea580c] dark:bg-[#ff914d]' : 'bg-stone-200 dark:bg-white/[0.12]'
                } ${deactivateLocked ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white transition-transform ${
                    service.is_active ? 'translate-x-5' : 'translate-x-1'
                  }`}
                />
              </button>

              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${service.is_active ? 'text-stone-900 dark:text-[#f5f5f5]' : 'text-stone-400 dark:text-[#666]'}`}>
                  {service.name}
                </p>
                {service.description && (
                  <p className="text-xs text-stone-500 dark:text-[#bdbdbf] truncate">{service.description}</p>
                )}
              </div>

              {service.price && (
                <span className="text-sm text-stone-600 dark:text-[#bdbdbf] shrink-0">{service.price}</span>
              )}

              <button
                type="button"
                onClick={() => (expandedId === service.id ? setExpandedId(null) : startEdit(service))}
                className="text-stone-400 dark:text-[#bdbdbf] hover:text-[#c2410c] dark:hover:text-[#ff914d] p-1"
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
                    className="text-xs text-stone-500 dark:text-[#bdbdbf] hover:text-stone-700 dark:hover:text-[#f5f5f5]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setDeleteConfirmId(service.id)}
                  disabled={deleteLocked}
                  title={deleteLocked ? floorExplanation : undefined}
                  aria-label={`Delete ${service.name}`}
                  className={`text-stone-400 dark:text-[#bdbdbf] hover:text-red-500 p-1 ${deleteLocked ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {errorFor(service.id, 'px-3 pb-2')}
            {(deactivateLocked || deleteLocked) && (
              <p className="px-3 pb-2 text-xs text-amber-700 dark:text-amber-300">
                {floorExplanation}
              </p>
            )}

            {expandedId === service.id && (
              <div className="border-t border-[#ece4d8] dark:border-white/[0.10] p-3 space-y-2 bg-[#faf6ef] dark:bg-white/[0.03]">
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Service name"
                  className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30"
                />
                <input
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30"
                />
                <input
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  placeholder="Price (optional)"
                  className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedId(null)}
                    className="px-3 py-1.5 text-sm text-stone-600 dark:text-[#bdbdbf] hover:text-stone-800 dark:hover:text-[#f5f5f5]"
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
          );
        })}
      </div>

      {showAddForm ? (
        <div className="border border-[#ea580c]/40 dark:border-[#ff914d]/30 rounded-lg p-3 space-y-2 bg-[#fdf1e7] dark:bg-white/[0.04]">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Service name *"
            className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30"
          />
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30"
          />
          <input
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder="Price (optional)"
            className="w-full px-3 py-2 rounded-lg text-sm bg-white text-stone-900 placeholder:text-stone-400 border border-[#e3dacc] focus:outline-none focus:border-[#ea580c] focus:ring-2 focus:ring-[#ea580c]/25 dark:bg-white/[0.06] dark:text-[#f5f5f5] dark:placeholder:text-[#666] dark:border-white/[0.12] dark:focus:border-[#ff914d] dark:focus:ring-[#ff914d]/30"
          />
          {errorFor('add')}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowAddForm(false); setNewName(''); setNewDescription(''); setNewPrice(''); setActionError(null); }}
              className="px-3 py-1.5 text-sm text-stone-600 dark:text-[#bdbdbf] hover:text-stone-800 dark:hover:text-[#f5f5f5]"
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
          className="flex items-center gap-1 text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a] font-medium"
        >
          <Plus className="w-4 h-4" /> Add Service
        </button>
      )}
    </div>
  );
}
