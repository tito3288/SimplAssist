"use client";

import { useState, useMemo } from "react";
import { Phone, MessageCircle, Search, Bot, User } from "lucide-react";
import { cn, formatPhoneNumber } from "@/lib/utils";
import type { ConversationWithContact } from "@/app/(dashboard)/conversations/page";

interface ConversationListProps {
  conversations: ConversationWithContact[];
  activeId: string | null;
  onSelect: (conversation: ConversationWithContact) => void;
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
}: ConversationListProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterTab>("all");

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
    <div className="flex h-full flex-col border-r border-gray-200 bg-white">
      {/* Search */}
      <div className="border-b border-gray-200 p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search conversations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              "flex-1 px-3 py-2 text-sm font-medium transition-colors",
              filter === tab.value
                ? "border-b-2 border-blue-600 text-blue-600"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-gray-500">
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
                  "flex w-full items-start gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors hover:bg-gray-50",
                  activeId === conv.id && "bg-blue-50 hover:bg-blue-50"
                )}
              >
                {/* Channel icon */}
                <div className="mt-0.5 flex-shrink-0">
                  {conv.channel === "sms" ? (
                    <Phone className="h-5 w-5 text-gray-400" />
                  ) : (
                    <MessageCircle className="h-5 w-5 text-gray-400" />
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">
                      {contactName}
                    </span>
                    <span className="flex-shrink-0 text-xs text-gray-500">
                      {timeAgo(conv.last_message_at)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-gray-500">
                    {preview}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    {/* AI/Human badge */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        conv.is_ai_handling
                          ? "bg-purple-100 text-purple-700"
                          : "bg-amber-100 text-amber-700"
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
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                        Closed
                      </span>
                    )}
                  </div>
                </div>

                {/* Unread indicator */}
                {conv.status === "active" && !conv.is_ai_handling && (
                  <div className="mt-2 h-2.5 w-2.5 flex-shrink-0 rounded-full bg-blue-500" />
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
