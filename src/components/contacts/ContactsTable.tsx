"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Search,
  Phone,
  MessageCircle,
  Flame,
  ArrowUpDown,
} from "lucide-react";
import { formatPhoneNumber } from "@/lib/utils";
import type { Contact, Conversation } from "@/types/database";
import ContactDetail from "./ContactDetail";

type Filter = "all" | "sms" | "web_chat" | "hot";
type Sort = "recent" | "score" | "name";

interface ContactWithCount extends Contact {
  conversation_count: number;
}

interface ContactsTableProps {
  contacts: ContactWithCount[];
  conversations: Conversation[];
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
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
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
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {score >= 7 && <Flame className="h-3 w-3" />}
      {label} ({score})
    </span>
  );
}

export default function ContactsTable({
  contacts: initialContacts,
  conversations: allConversations,
}: ContactsTableProps) {
  const [contacts, setContacts] = useState(initialContacts);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [selectedContact, setSelectedContact] = useState<ContactWithCount | null>(null);

  // Keep contacts in sync when props change
  useEffect(() => {
    setContacts(initialContacts);
  }, [initialContacts]);

  const filtered = useMemo(() => {
    let result = contacts;

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          (c.name && c.name.toLowerCase().includes(q)) ||
          (c.phone_number && c.phone_number.includes(q)) ||
          (c.email && c.email.toLowerCase().includes(q))
      );
    }

    // Filter
    if (filter === "sms") result = result.filter((c) => c.source_channel === "sms");
    if (filter === "web_chat") result = result.filter((c) => c.source_channel === "web_chat");
    if (filter === "hot") result = result.filter((c) => c.lead_score >= 7);

    // Sort
    result = [...result].sort((a, b) => {
      if (sort === "recent")
        return new Date(b.last_contacted_at).getTime() - new Date(a.last_contacted_at).getTime();
      if (sort === "score") return b.lead_score - a.lead_score;
      return (a.name ?? "").localeCompare(b.name ?? "");
    });

    return result;
  }, [contacts, search, filter, sort]);

  const selectedConversations = useMemo(
    () =>
      selectedContact
        ? allConversations.filter((c) => c.contact_id === selectedContact.id)
        : [],
    [selectedContact, allConversations]
  );

  function handleUpdated(updated: Contact) {
    setContacts((prev) =>
      prev.map((c) =>
        c.id === updated.id
          ? { ...updated, conversation_count: c.conversation_count }
          : c
      )
    );
    setSelectedContact((prev) =>
      prev && prev.id === updated.id
        ? { ...updated, conversation_count: prev.conversation_count }
        : prev
    );
  }

  function handleDeleted(id: string) {
    setContacts((prev) => prev.filter((c) => c.id !== id));
    setSelectedContact(null);
  }

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "sms", label: "SMS" },
    { key: "web_chat", label: "Web Chat" },
    { key: "hot", label: "Hot Leads" },
  ];

  const sorts: { key: Sort; label: string }[] = [
    { key: "recent", label: "Most Recent" },
    { key: "score", label: "Highest Score" },
    { key: "name", label: "Name A-Z" },
  ];

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Search */}
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search contacts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Filters */}
          <div className="flex rounded-lg border border-gray-200 bg-white">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 text-xs font-medium transition ${
                  filter === f.key
                    ? "bg-blue-600 text-white"
                    : "text-gray-600 hover:bg-gray-50"
                } ${f.key === "all" ? "rounded-l-lg" : ""} ${
                  f.key === "hot" ? "rounded-r-lg" : ""
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Sort */}
          <div className="relative">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-xs font-medium text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {sorts.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <ArrowUpDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-gray-500">
            No contacts found
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <th className="px-6 py-3">Name</th>
                <th className="px-6 py-3 hidden sm:table-cell">Phone</th>
                <th className="px-6 py-3 hidden md:table-cell">Email</th>
                <th className="px-6 py-3">Channel</th>
                <th className="px-6 py-3">Lead Score</th>
                <th className="px-6 py-3 hidden lg:table-cell">Conversations</th>
                <th className="px-6 py-3 hidden lg:table-cell">Last Contact</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((contact) => (
                <tr
                  key={contact.id}
                  onClick={() => setSelectedContact(contact)}
                  className="cursor-pointer transition hover:bg-blue-50/50"
                >
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {contact.name || "Unknown"}
                  </td>
                  <td className="hidden px-6 py-4 text-sm text-gray-600 sm:table-cell">
                    {contact.phone_number
                      ? formatPhoneNumber(contact.phone_number)
                      : "—"}
                  </td>
                  <td className="hidden px-6 py-4 text-sm text-gray-600 md:table-cell">
                    {contact.email || "—"}
                  </td>
                  <td className="px-6 py-4">
                    {contact.source_channel === "sms" ? (
                      <Phone className="h-4 w-4 text-blue-500" />
                    ) : (
                      <MessageCircle className="h-4 w-4 text-violet-500" />
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <LeadBadge score={contact.lead_score} />
                  </td>
                  <td className="hidden px-6 py-4 text-sm text-gray-600 lg:table-cell">
                    {contact.conversation_count}
                  </td>
                  <td className="hidden px-6 py-4 text-sm text-gray-500 lg:table-cell">
                    {relativeTime(contact.last_contacted_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Panel */}
      {selectedContact && (
        <ContactDetail
          contact={selectedContact}
          conversations={selectedConversations}
          onClose={() => setSelectedContact(null)}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
      )}
    </>
  );
}
