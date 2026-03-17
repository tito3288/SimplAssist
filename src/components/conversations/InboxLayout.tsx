"use client";

import { useState } from "react";
import { ArrowLeft, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConversationList } from "./ConversationList";
import { MessageThread } from "./MessageThread";
import type { ConversationWithContact } from "@/app/(dashboard)/conversations/page";

interface InboxLayoutProps {
  conversations: ConversationWithContact[];
  businessId: string;
}

export function InboxLayout({ conversations, businessId }: InboxLayoutProps) {
  const [selected, setSelected] = useState<ConversationWithContact | null>(null);

  return (
    <div className="flex h-full overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
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
            <div className="flex items-center border-b border-gray-200 px-3 py-2 md:hidden">
              <button
                onClick={() => setSelected(null)}
                className="flex items-center gap-1 text-sm text-blue-600"
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
          <div className="flex h-full flex-col items-center justify-center text-gray-400">
            <MessageSquare className="mb-3 h-12 w-12" />
            <p className="text-sm">Select a conversation to view messages</p>
          </div>
        )}
      </div>
    </div>
  );
}
