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
  let color = "bg-gray-100 text-gray-700";
  let label = "Cold";
  if (score >= 7) {
    color = "bg-green-100 text-green-700";
    label = "Hot";
  } else if (score >= 4) {
    color = "bg-yellow-100 text-yellow-700";
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
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Contact Details
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 p-6">
          {/* Name */}
          <div>
            <label className="text-xs font-medium uppercase text-gray-400">
              Name
            </label>
            {editingName ? (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => e.key === "Enter" && saveName()}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            ) : (
              <p
                onClick={() => setEditingName(true)}
                className="mt-1 cursor-pointer rounded-lg px-3 py-2 text-sm text-gray-900 hover:bg-gray-50"
              >
                {contact.name || "Unknown"}{" "}
                <span className="text-xs text-gray-400">(click to edit)</span>
              </p>
            )}
          </div>

          {/* Phone */}
          {contact.phone_number && (
            <div>
              <label className="text-xs font-medium uppercase text-gray-400">
                Phone
              </label>
              <p className="mt-1 flex items-center gap-2 text-sm text-gray-900">
                <Phone className="h-4 w-4 text-gray-400" />
                {formatPhoneNumber(contact.phone_number)}
              </p>
            </div>
          )}

          {/* Email */}
          {contact.email && (
            <div>
              <label className="text-xs font-medium uppercase text-gray-400">
                Email
              </label>
              <p className="mt-1 text-sm text-gray-900">{contact.email}</p>
            </div>
          )}

          {/* Channel & Lead Score */}
          <div className="flex items-center gap-6">
            <div>
              <label className="text-xs font-medium uppercase text-gray-400">
                Channel
              </label>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-gray-900">
                {contact.source_channel === "sms" ? (
                  <Phone className="h-4 w-4 text-blue-500" />
                ) : (
                  <MessageCircle className="h-4 w-4 text-violet-500" />
                )}
                {contact.source_channel === "sms" ? "SMS" : "Web Chat"}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-gray-400">
                Lead Score
              </label>
              <div className="mt-1">
                <LeadBadge score={contact.lead_score} />
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="flex items-center gap-6">
            <div>
              <label className="text-xs font-medium uppercase text-gray-400">
                Created
              </label>
              <p className="mt-1 text-sm text-gray-600">
                {formatDate(contact.created_at, "PP")}
              </p>
            </div>
            <div>
              <label className="text-xs font-medium uppercase text-gray-400">
                Last Contacted
              </label>
              <p className="mt-1 text-sm text-gray-600">
                {relativeTime(contact.last_contacted_at)}
              </p>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium uppercase text-gray-400">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Add notes about this contact..."
              rows={3}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Conversations */}
          <div>
            <label className="text-xs font-medium uppercase text-gray-400">
              Conversations ({conversations.length})
            </label>
            {conversations.length === 0 ? (
              <p className="mt-2 text-sm text-gray-400">No conversations yet</p>
            ) : (
              <div className="mt-2 space-y-2">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() =>
                      router.push(`/conversations?conversation=${conv.id}`)
                    }
                    className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-4 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50/50"
                  >
                    <div className="flex items-center gap-3">
                      {conv.channel === "sms" ? (
                        <Phone className="h-4 w-4 text-blue-500" />
                      ) : (
                        <MessageCircle className="h-4 w-4 text-violet-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {conv.channel === "sms" ? "SMS" : "Web Chat"}
                        </p>
                        <p className="text-xs text-gray-500">
                          {relativeTime(conv.last_message_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          conv.status === "active"
                            ? "bg-green-100 text-green-700"
                            : conv.status === "handed_off"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {conv.status}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 text-gray-400" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Delete */}
          <div className="border-t pt-4">
            {confirmDelete ? (
              <div className="flex items-center gap-3">
                <p className="text-sm text-red-600">
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
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700"
              >
                <Trash2 className="h-4 w-4" />
                Delete Contact
              </button>
            )}
          </div>

          {saving && (
            <p className="text-xs text-gray-400">Saving...</p>
          )}
        </div>
      </div>
    </div>
  );
}
