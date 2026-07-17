"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Bot, User, ArrowLeftRight, Phone, MessageCircle, Info } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase/client";
import { cn, formatPhoneNumber } from "@/lib/utils";
import {
  statusSuccess,
  statusWarning,
  statusNeutral,
  statusInfo,
} from "@/lib/theme-v2/theme";
import type { Message, SmsBlockReason } from "@/types/database";
import type { ConversationWithContact } from "@/app/(dashboard)/conversations/page";

interface MessageThreadProps {
  conversation: ConversationWithContact;
  businessId: string;
  smsReady: boolean;
  smsBlockReason: SmsBlockReason | null;
  /** Dev-only demo mode (/demo routes): seed messages and disable all
   *  Supabase I/O. Real dashboard callers never pass this. */
  demoMessages?: Message[];
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function smsPausedCopy(reason: SmsBlockReason | null): string {
  switch (reason) {
    case "assignment_pending":
      return "Your campaign is approved, and Telnyx is linking your phone number to it. You can reply once assignment finishes.";
    case "assignment_failed":
      return "Your campaign is approved, but phone number assignment needs attention before replies can send.";
    case "missing_phone_number":
      return "Add an active phone number before replying by SMS.";
    case "missing_messaging_profile":
      return "Messaging setup is incomplete. Contact support from the Support page before replying by SMS.";
    case "campaign_not_approved":
    default:
      return "Your campaign is still under carrier review. You can reply once it is approved.";
  }
}

export function MessageThread({
  conversation,
  businessId,
  smsReady,
  smsBlockReason,
  demoMessages,
}: MessageThreadProps) {
  const [messages, setMessages] = useState<Message[]>(demoMessages ?? []);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [isAiHandling, setIsAiHandling] = useState(conversation.is_ai_handling);
  const [toggling, setToggling] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const supabase = createBrowserClient();
  const smsBlocked = conversation.channel === "sms" && !smsReady;

  // Fetch messages
  useEffect(() => {
    if (demoMessages) {
      // Demo mode: the setter (not just the useState seed) matters because the
      // component instance persists when another conversation is selected.
      setMessages(demoMessages);
      setIsAiHandling(conversation.is_ai_handling);
      return;
    }

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
  }, [conversation.id, conversation.is_ai_handling, supabase, demoMessages]);

  // Real-time subscription
  useEffect(() => {
    if (demoMessages) return;
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
  }, [conversation.id, supabase, demoMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    if (!input.trim() || sending || isAiHandling || smsBlocked || demoMessages) return;

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

      if (conversation.channel === "sms" && conversation.contact?.phone_number) {
        await fetch("/api/messaging/send", {
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
    if (demoMessages) return;
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
      <div className="flex items-center justify-between border-b border-[#ece4d8] dark:border-white/[0.10] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100 dark:bg-white/[0.06]">
            {conversation.channel === "sms" ? (
              <Phone className="h-5 w-5 text-stone-500 dark:text-[#bdbdbf]" />
            ) : (
              <MessageCircle className="h-5 w-5 text-stone-500 dark:text-[#bdbdbf]" />
            )}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-stone-900 dark:text-[#f5f5f5]">{contactName}</h2>
            <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-[#bdbdbf]">
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
                    ? statusSuccess
                    : conversation.status === "handed_off"
                    ? statusWarning
                    : statusNeutral
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
              ? "bg-stone-100 dark:bg-white/[0.08] text-stone-700 dark:text-[#d4d4d8] hover:bg-stone-200 dark:hover:bg-white/[0.12]"
              : "bg-[#fdf1e7] dark:bg-[rgba(255,145,77,.16)] text-[#c2410c] dark:text-[#ffd5bc] hover:bg-[#fbe6d4] dark:hover:bg-[rgba(255,145,77,.24)]",
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
          <div className="flex h-full items-center justify-center text-sm text-stone-400 dark:text-[#bdbdbf]">
            No messages in this conversation yet.
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((msg) => {
              const isCustomer = msg.role === "customer";
              const isHumanAgent = msg.role === "human_agent";
              const isSystem = msg.role === "system";

              if (isSystem) {
                return (
                  <div key={msg.id} className="flex justify-center">
                    <div className="max-w-[80%] rounded-full bg-stone-100 dark:bg-white/[0.06] border border-stone-200 dark:border-white/[0.10] px-3 py-1.5 text-center text-xs text-stone-600 dark:text-[#cfcfcf]">
                      <Info className="mr-1 inline-block h-3 w-3 align-[-2px]" />
                      {msg.content}
                    </div>
                  </div>
                );
              }

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
                        "mb-1 flex items-center gap-1 text-xs text-stone-400 dark:text-[#bdbdbf]",
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
                          ? "rounded-bl-md border border-[#ece4d8] dark:border-white/[0.08] bg-[#f3ede3] dark:bg-white/[0.06] text-stone-800 dark:text-[#f0f0f0]"
                          : isHumanAgent
                          ? "rounded-br-md bg-stone-800 text-white dark:bg-white/[0.16] dark:text-[#f5f5f5]"
                          : "rounded-br-md bg-[#ea580c] text-white dark:bg-[#ff914d] dark:text-[#16100b]"
                      )}
                    >
                      {msg.content}
                    </div>
                    {/* Timestamp */}
                    <div
                      className={cn(
                        "mt-1 text-xs text-stone-400 dark:text-[#bdbdbf]",
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
      <div className="border-t border-[#ece4d8] dark:border-white/[0.10] px-4 py-3">
        {isAiHandling ? (
          <div className={cn("flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm", statusInfo)}>
            <Bot className="h-4 w-4" />
            AI is handling this conversation. Click &quot;Take Over&quot; to reply manually.
          </div>
        ) : smsBlocked ? (
          <div className={cn("flex items-start gap-3 rounded-lg px-4 py-3 text-sm", statusWarning)}>
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-300">SMS sending paused</p>
              <p className="mt-0.5 text-xs text-amber-600/90 dark:text-amber-300/80">
                {smsPausedCopy(smsBlockReason)}
              </p>
            </div>
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
              className="flex-1 rounded-lg bg-white dark:bg-white/[0.06] border border-[#e3dacc] dark:border-white/[0.12] px-4 py-2 text-sm text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:border-[#ea580c] dark:focus:border-[#ff914d] focus:outline-none focus:ring-2 focus:ring-[#ea580c]/25 dark:focus:ring-[#ff914d]/30"
              disabled={sending}
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#ea580c] hover:bg-[#c2410c] active:bg-[#9a3412] dark:bg-[#ff914d] dark:text-[#16100b] dark:hover:bg-[#f57f33] text-white transition-colors disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
