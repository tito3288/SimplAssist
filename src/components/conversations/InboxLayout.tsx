"use client";

import { useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationList } from "./ConversationList";
import { MessageThread } from "./MessageThread";
import type { ConversationWithContact } from "@/app/(dashboard)/conversations/page";
import { glassCard } from "@/lib/glass";

interface InboxLayoutProps {
  conversations: ConversationWithContact[];
  businessId: string;
}

export function InboxLayout({ conversations: initialConversations, businessId }: InboxLayoutProps) {
  const [conversations, setConversations] = useState(initialConversations);
  const [selected, setSelected] = useState<ConversationWithContact | null>(null);

  function handleDelete(id: string) {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (selected?.id === id) {
      setSelected(null);
    }
  }

  return (
    <div className={`flex h-full overflow-hidden ${glassCard}`}>
      {/* Conversation list - left panel */}
      <div
        className={cn(
          "h-full w-full flex-shrink-0 md:w-[350px] md:block",
          selected ? "hidden" : "block"
        )}
      >
        <ConversationList
          conversations={conversations}
          activeId={selected?.id ?? null}
          onSelect={setSelected}
          onDelete={handleDelete}
        />
      </div>

      {/* Message thread - right panel */}
      <div
        className={cn(
          "h-full flex-1 md:block",
          selected ? "block" : "hidden"
        )}
      >
        {selected ? (
          <div className="flex h-full flex-col">
            {/* Mobile back button */}
            <div className="flex items-center border-b border-slate-200 dark:border-white/[0.10] px-3 py-2 md:hidden">
              <button
                onClick={() => setSelected(null)}
                className="flex items-center gap-1 text-sm text-[#ff914d]"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <MessageThread
                conversation={selected}
                businessId={businessId}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-slate-400 dark:text-[#bdbdbf]">
            <MessageSquare className="mb-3 h-12 w-12" />
            <p className="text-sm">Select a conversation to view messages</p>
          </div>
        )}
      </div>
    </div>
  );
}
