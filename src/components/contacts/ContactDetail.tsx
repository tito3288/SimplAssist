"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  X,
  Phone,
  MessageCircle,
  Flame,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { formatPhoneNumber, formatDate } from "@/lib/utils";
import type { Contact, Conversation } from "@/types/database";
import { glassInput, textPrimary, textSecondary } from "@/lib/glass";

interface ContactDetailProps {
  contact: Contact;
  conversations: Conversation[];
  onClose: () => void;
  onUpdated: (contact: Contact) => void;
  onDeleted: (contactId: string) => void;
}

function relativeTime(date: string): string {
  const now = new Date();
  const d = new Date(date);
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return formatDate(date, "PP");
}

function LeadBadge({ score }: { score: number }) {
  let color = "bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-[#bdbdbf]";
  let label = "Cold";
  if (score >= 7) {
    color = "bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400";
    label = "Hot";
  } else if (score >= 4) {
    color = "bg-yellow-100 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400";
    label = "Warm";
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
      {score >= 7 && <Flame className="h-3 w-3" />}
      {label} ({score})
    </span>
  );
}

export default function ContactDetail({
  contact,
  conversations,
  onClose,
  onUpdated,
  onDeleted,
}: ContactDetailProps) {
  const router = useRouter();
  const supabase = createBrowserClient();

  const [name, setName] = useState(contact.name ?? "");
  const [editingName, setEditingName] = useState(false);
  const [notes, setNotes] = useState(contact.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);

  async function saveName() {
    setEditingName(false);
    const trimmed = name.trim() || null;
    if (trimmed === contact.name) return;
    setSaving(true);
    const { data } = await supabase
      .from("contacts")
      .update({ name: trimmed })
      .eq("id", contact.id)
      .select()
      .single();
    setSaving(false);
    if (data) onUpdated(data as Contact);
  }

  async function saveNotes() {
    const trimmed = notes.trim() || null;
    if (trimmed === contact.notes) return;
    setSaving(true);
    const { data } = await supabase
      .from("contacts")
      .update({ notes: trimmed })
      .eq("id", contact.id)
      .select()
      .single();
    setSaving(false);
    if (data) onUpdated(data as Contact);
  }

  async function deleteContact() {
    setSaving(true);
    await supabase.from("contacts").delete().eq("id", contact.id);
    setSaving(false);
    onDeleted(contact.id);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20 dark:bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-full sm:max-w-lg flex-col overflow-y-auto bg-white dark:bg-[rgba(18,18,20,0.95)] dark:backdrop-blur-[20px] shadow-xl dark:shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/[0.10] px-6 py-4">
          <h2 className={`text-lg font-semibold ${textPrimary}`}>
            Contact Details
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 dark:text-[#666] hover:bg-slate-50 dark:hover:bg-white/[0.04] hover:text-slate-600 dark:hover:text-[#bdbdbf]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 p-6">
          {/* Name */}
          <div>
            <label className="text-xs font-medium uppercase text-gray-400 dark:text-[#666]">
              Name
            </label>
            {editingName ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                className={`mt-1 block w-full rounded-lg px-3 py-2 text-sm focus:outline-none ${glassInput}`}
              />
            ) : (
              <p
                onClick={() => setEditingName(true)}
                className={`mt-1 cursor-pointer rounded-lg px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-white/[0.04] ${textPrimary}`}
              >
                {contact.name || "Unknown"}{" "}
                <span className="text-xs text-gray-400 dark:text-[#666]">(click to edit)</span>
              </p>
            )}
          </div>

          {/* Phone */}
          {contact.phone_number && (
            <div>
              <label className="text-xs font-medium uppercase text-gray-400 dark:text-[#666]">
                Phone
              </label>
              <p className={`mt-1 flex items-center gap-2 text-sm ${textPrimary}`}>
                <Phone className="h-4 w-4 text-gray-400 dark:text-[#666]" />
                {formatPhoneNumber(contact.phone_number)}
              </p>
            </div>
          )}

          {/* Email */}
          {contact.email && (
            <div>
              <label className="text-xs font-medium uppercase text-gray-400 dark:text-[#666]">
                Email
              </label>
              <p className={`mt-1 text-sm ${textPrimary}`}>{contact.email}</p>
            </div>
          )}

          {/* Channel & Lead Score */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <div>
              <label className="text-xs font-medium uppercase text-gray-400 dark:text-[#666]">
                Channel
              </label>
              <p className={`mt-1 flex items-center gap-1.5 text-sm ${textPrimary}`}>
                {contact.source_channel === "sms" ? (
                  <Phone className="h-4 w-4 text-[#ff914d]" />
                ) : (
                  <MessageCircle className="h-4 w-4 text-violet-500 dark:text-violet-400" />
                )}
                {contact.source_channel === "sms" ? "SMS" : "Web Chat"}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-gray-400 dark:text-[#666]">
                Lead Score
              </label>
              <div className="mt-1">
                <LeadBadge score={contact.lead_score} />
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <div>
              <label className="text-xs font-medium uppercase text-gray-400 dark:text-[#666]">
                Created
              </label>
              <p className={`mt-1 text-sm ${textSecondary}`}>
                {formatDate(contact.created_at, "PP")}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-gray-400 dark:text-[#666]">
                Last Contacted
              </label>
              <p className={`mt-1 text-sm ${textSecondary}`}>
                {relativeTime(contact.last_contacted_at)}
              </p>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium uppercase text-gray-400 dark:text-[#666]">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Add notes about this contact..."
              rows={3}
              className={`mt-1 block w-full rounded-lg px-3 py-2 text-sm focus:outline-none ${glassInput}`}
            />
          </div>

          {/* Conversations */}
          <div>
            <label className="text-xs font-medium uppercase text-gray-400 dark:text-[#666]">
              Conversations ({conversations.length})
            </label>
            {conversations.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400 dark:text-[#666]">No conversations yet</p>
            ) : (
              <div className="mt-2 space-y-2">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() =>
                      router.push(`/conversations?conversation=${conv.id}`)
                    }
                    className="flex w-full items-center justify-between rounded-lg border border-slate-200 dark:border-white/[0.10] px-4 py-3 text-left transition hover:border-[#ff914d]/40 hover:bg-orange-50 dark:hover:bg-[rgba(255,145,77,.08)]"
                  >
                    <div className="flex items-center gap-3">
                      {conv.channel === "sms" ? (
                        <Phone className="h-4 w-4 text-[#ff914d]" />
                      ) : (
                        <MessageCircle className="h-4 w-4 text-violet-500 dark:text-violet-400" />
                      )}
                      <div>
                        <p className={`text-sm font-medium ${textPrimary}`}>
                          {conv.channel === "sms" ? "SMS" : "Web Chat"}
                        </p>
                        <p className={`text-xs ${textSecondary}`}>
                          {relativeTime(conv.last_message_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          conv.status === "active"
                            ? "bg-green-100 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                            : conv.status === "handed_off"
                            ? "bg-yellow-100 dark:bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
                            : "bg-gray-100 dark:bg-white/[0.06] text-gray-600 dark:text-[#bdbdbf]"
                        }`}
                      >
                        {conv.status}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-gray-400 dark:text-[#666]" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Delete */}
          <div className="border-t border-slate-200 dark:border-white/[0.10] pt-4">
            {confirmDelete ? (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <p className="text-sm text-red-600 dark:text-red-400">
                  Delete this contact and all their data?
                </p>
                <button
                  onClick={deleteContact}
                  disabled={saving}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-lg border border-slate-200 dark:border-white/[0.10] px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-[#bdbdbf] hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
              >
                <Trash2 className="h-4 w-4" />
                Delete Contact
              </button>
            )}
          </div>

          {saving && (
            <p className="text-xs text-gray-400 dark:text-[#666]">Saving...</p>
          )}
        </div>
      </div>
    </div>
  );
}
