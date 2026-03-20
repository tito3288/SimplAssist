"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Bot, User, ArrowLeftRight, Phone, MessageCircle } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { cn, formatPhoneNumber } from "@/lib/utils";
import type { Message } from "@/types/database";
import type { ConversationWithContact } from "@/app/(dashboard)/conversations/page";

interface MessageThreadProps {
  conversation: ConversationWithContact;
  businessId: string;
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function MessageThread({ conversation, businessId }: MessageThreadProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isAiHandling, setIsAiHandling] = useState(conversation.is_ai_handling);
  const [toggling, setToggling] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createBrowserClient();

  // Fetch messages
  useEffect(() => {
    async function fetchMessages() {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });

      if (data) setMessages(data as Message[]);
    }

    fetchMessages();
    setIsAiHandling(conversation.is_ai_handling);
  }, [conversation.id, conversation.is_ai_handling, supabase]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel(`messages:${conversation.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversation.id}`,
        },
        (payload) => {
          setMessages((prev) => {
            // Avoid duplicates
            if (prev.some((m) => m.id === (payload.new as Message).id)) return prev;
            return [...prev, payload.new as Message];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversation.id, supabase]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || sending || isAiHandling) return;

    setSending(true);
    const content = input.trim();
    setInput("");

    try {
      // Save the message
      const { data: newMsg } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          business_id: businessId,
          role: "human_agent",
          content,
          channel: conversation.channel,
        })
        .select("*")
        .single();

      if (newMsg) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === newMsg.id)) return prev;
          return [...prev, newMsg as Message];
        });
      }

      // Update last_message_at
      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversation.id);

      // If SMS, also send via Twilio
      if (conversation.channel === "sms" && conversation.contact?.phone_number) {
        await fetch("/api/twilio/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: conversation.contact.phone_number,
            message: content,
            businessId,
          }),
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setSending(false);
    }
  }

  async function toggleAiHandling() {
    setToggling(true);
    const newValue = !isAiHandling;

    try {
      await supabase
        .from("conversations")
        .update({
          is_ai_handling: newValue,
          status: newValue ? "active" : "handed_off",
        })
        .eq("id", conversation.id);

      setIsAiHandling(newValue);
    } catch (error) {
      console.error("Error toggling AI handling:", error);
    } finally {
      setToggling(false);
    }
  }

  const contactName =
    conversation.contact?.name ||
    (conversation.contact?.phone_number
      ? formatPhoneNumber(conversation.contact.phone_number)
      : "Unknown");

  return (
    <div className="flex h-full flex-col bg-white dark:bg-transparent">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-white/[0.10] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 dark:bg-white/[0.06]">
            {conversation.channel === "sms" ? (
              <Phone className="h-5 w-5 text-slate-500 dark:text-[#bdbdbf]" />
            ) : (
              <MessageCircle className="h-5 w-5 text-slate-500 dark:text-[#bdbdbf]" />
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-[#f5f5f5]">{contactName}</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-[#bdbdbf]">
              {conversation.contact?.phone_number && (
                <span>{formatPhoneNumber(conversation.contact.phone_number)}</span>
              )}
              {conversation.contact?.email && (
                <span>· {conversation.contact.email}</span>
              )}
              <span>
                · {conversation.channel === "sms" ? "SMS" : "Web Chat"}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 font-medium",
                  conversation.status === "active"
                    ? "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300"
                    : conversation.status === "handed_off"
                    ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300"
                    : "bg-slate-100 dark:bg-white/[0.06] text-slate-500 dark:text-[#bdbdbf]"
                )}
              >
                {conversation.status === "handed_off"
                  ? "Handed Off"
                  : conversation.status.charAt(0).toUpperCase() +
                    conversation.status.slice(1)}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={toggleAiHandling}
          disabled={toggling}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isAiHandling
              ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/30"
              : "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-500/30",
            toggling && "opacity-50"
          )}
        >
          <ArrowLeftRight className="h-4 w-4" />
          {isAiHandling ? "Take Over" : "Let AI Handle"}
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400 dark:text-[#bdbdbf]">
            No messages in this conversation yet.
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const isCustomer = msg.role === "customer";
              const isHumanAgent = msg.role === "human_agent";

              return (
                <div
                  key={msg.id}
                  className={cn(
                    "flex",
                    isCustomer ? "justify-start" : "justify-end"
                  )}
                >
                  <div className="max-w-[70%]">
                    {/* Role label */}
                    <div
                      className={cn(
                        "mb-1 flex items-center gap-1 text-xs text-slate-400 dark:text-[#bdbdbf]",
                        isCustomer ? "justify-start" : "justify-end"
                      )}
                    >
                      {isCustomer ? (
                        "Customer"
                      ) : isHumanAgent ? (
                        <>
                          <User className="h-3 w-3" /> Agent
                        </>
                      ) : (
                        <>
                          <Bot className="h-3 w-3" /> AI
                        </>
                      )}
                    </div>
                    {/* Bubble */}
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-2 text-sm",
                        isCustomer
                          ? "rounded-bl-md bg-slate-100 dark:bg-white/[0.06] text-slate-900 dark:text-[#f5f5f5]"
                          : isHumanAgent
                          ? "rounded-br-md bg-green-500 text-white"
                          : "rounded-br-md bg-blue-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white"
                      )}
                    >
                      {msg.content}
                    </div>
                    {/* Timestamp */}
                    <div
                      className={cn(
                        "mt-1 text-xs text-slate-400 dark:text-[#bdbdbf]",
                        isCustomer ? "text-left" : "text-right"
                      )}
                    >
                      {formatTimestamp(msg.created_at)}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 dark:border-white/[0.10] px-4 py-3">
        {isAiHandling ? (
          <div className="flex items-center justify-center gap-2 rounded-lg bg-purple-50 dark:bg-purple-500/10 px-4 py-3 text-sm text-purple-600 dark:text-purple-300">
            <Bot className="h-4 w-4" />
            AI is handling this conversation. Click &quot;Take Over&quot; to reply manually.
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 rounded-lg bg-white dark:bg-white/[0.06] border border-gray-300 dark:border-white/[0.12] px-4 py-2 text-sm text-slate-900 dark:text-[#f5f5f5] placeholder:text-gray-400 dark:placeholder:text-[#666] focus:border-[#ff914d] focus:outline-none focus:ring-1 focus:ring-[#ff914d]"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500 dark:bg-transparent dark:bg-[linear-gradient(135deg,#ff914d,#ffb07a)] text-white transition-colors hover:bg-orange-600 dark:hover:brightness-110 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
