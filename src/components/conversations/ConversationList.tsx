"use client";

import { useState, useMemo } from "react";
import { Phone, MessageCircle, Search, Bot, User, Trash2, Loader2 } from "lucide-react";
import { cn, formatPhoneNumber } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";
import type { ConversationWithContact } from "@/app/(dashboard)/conversations/page";

interface ConversationListProps {
  conversations: ConversationWithContact[];
  activeId: string | null;
  onSelect: (conversation: ConversationWithContact) => void;
  onDelete: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

type FilterTab = "all" | "sms" | "web_chat";

export function ConversationList({
  conversations,
  activeId,
  onSelect,
  onDelete,
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function handleConfirmDelete() {
    if (!deleteTargetId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/conversations/${deleteTargetId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        onDelete(deleteTargetId);
      }
    } catch {
      // Handle silently
    } finally {
      setDeleting(false);
      setDeleteTargetId(null);
    }
  }

  const filtered = useMemo(() => {
    let result = conversations;

    if (filter !== "all") {
      result = result.filter((c) => c.channel === filter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone_number ?? "";
        return name.includes(q) || phone.includes(q);
      });
    }

    return result;
  }, [conversations, filter, search]);

  const tabs: { label: string; value: FilterTab }[] = [
    { label: "All", value: "all" },
    { label: "SMS", value: "sms" },
    { label: "Web Chat", value: "web_chat" },
  ];

  return (
    <div className="flex h-full flex-col border-r border-slate-200 dark:border-white/[0.10] bg-white dark:bg-transparent">
      {/* Search */}
      <div className="border-b border-slate-200 dark:border-white/[0.10] p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#666]" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg bg-white dark:bg-white/[0.06] border border-gray-300 dark:border-white/[0.12] py-2 pl-9 pr-3 text-sm text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:border-[#ff914d] focus:outline-none focus:ring-1 focus:ring-[#ff914d]"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-slate-200 dark:border-white/[0.10]">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              "flex-1 px-3 py-2 text-sm font-medium transition-colors",
              filter === tab.value
                ? "border-b-2 border-[#ff914d] text-[#ff914d]"
                : "text-slate-500 dark:text-[#bdbdbf] hover:text-slate-700 dark:hover:text-[#f5f5f5]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500 dark:text-[#bdbdbf]">
            {conversations.length === 0
              ? "No conversations yet. Once customers start texting or chatting, they'll appear here."
              : "No conversations match your search."}
          </div>
        ) : (
          filtered.map((conv) => {
            const contactName =
              conv.contact?.name ||
              (conv.contact?.phone_number
                ? formatPhoneNumber(conv.contact.phone_number)
                : "Unknown");
            const preview = conv.last_message_preview
              ? conv.last_message_preview.length > 50
                ? conv.last_message_preview.slice(0, 50) + "..."
                : conv.last_message_preview
              : "No messages yet";

            return (
              <button
                key={conv.id}
                onClick={() => onSelect(conv)}
                className={cn(
                  "group flex w-full items-start gap-3 border-b border-slate-100 dark:border-white/[0.06] px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.04]",
                  activeId === conv.id && "bg-orange-50 dark:bg-[rgba(255,145,77,.08)] hover:bg-orange-50 dark:hover:bg-[rgba(255,145,77,.08)]"
                )}
              >
                {/* Channel icon */}
                <div className="mt-0.5 flex-shrink-0">
                  {conv.channel === "sms" ? (
                    <Phone className="h-5 w-5 text-slate-400 dark:text-[#bdbdbf]" />
                  ) : (
                    <MessageCircle className="h-5 w-5 text-slate-400 dark:text-[#bdbdbf]" />
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-slate-900 dark:text-[#f5f5f5]">
                      {contactName}
                    </span>
                    <span className="flex-shrink-0 text-xs text-slate-500 dark:text-[#bdbdbf]">
                      {timeAgo(conv.last_message_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-[#bdbdbf]">
                    {preview}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    {/* AI/Human badge */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        conv.is_ai_handling
                          ? "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300"
                          : "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
                      )}
                    >
                      {conv.is_ai_handling ? (
                        <>
                          <Bot className="h-3 w-3" /> AI
                        </>
                      ) : (
                        <>
                          <User className="h-3 w-3" /> Human
                        </>
                      )}
                    </span>
                    {/* Status badge */}
                    {conv.status === "closed" && (
                      <span className="rounded-full bg-slate-100 dark:bg-white/[0.06] px-2 py-0.5 text-xs text-slate-500 dark:text-[#bdbdbf]">
                        Closed
                      </span>
                    )}
                  </div>
                </div>

                {/* Delete + Unread indicator */}
                <div className="mt-1 flex flex-col items-center gap-1 flex-shrink-0">
                  {conv.status === "active" && !conv.is_ai_handling && (
                    <div className="h-2.5 w-2.5 rounded-full bg-[#ff914d]" />
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTargetId(conv.id);
                    }}
                    className="p-1 rounded-lg text-slate-300 dark:text-white/[0.15] hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete conversation"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Delete confirmation modal */}
      <Modal
        open={!!deleteTargetId}
        onClose={() => setDeleteTargetId(null)}
        title="Delete Conversation"
        description="Are you sure? This will permanently delete this conversation and all its messages."
      >
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => setDeleteTargetId(null)}
            disabled={deleting}
            className="flex-1 rounded-full border border-slate-200 dark:border-white/[0.12] px-4 py-2.5 text-sm font-medium text-slate-700 dark:text-[#bdbdbf] hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirmDelete}
            disabled={deleting}
            className="flex-1 inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {deleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
