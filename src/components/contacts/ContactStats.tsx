"use client";

import { Users, UserPlus, Flame, Phone, MessageCircle } from "lucide-react";
import type { Contact } from "@/types/database";
import { glassCard, orangeAccentIcon, textPrimary, textSecondary } from "@/lib/glass";

interface ContactStatsProps {
  contacts: Contact[];
}

export default function ContactStats({ contacts }: ContactStatsProps) {
  const total = contacts.length;

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const newThisWeek = contacts.filter(
    (c) => new Date(c.created_at) >= oneWeekAgo
  ).length;

  const hotLeads = contacts.filter((c) => c.lead_score >= 7).length;

  const smsCount = contacts.filter((c) => c.source_channel === "sms").length;
  const webChatCount = contacts.filter(
    (c) => c.source_channel === "web_chat"
  ).length;

  const stats = [
    {
      label: "Total Contacts",
      value: total,
      icon: Users,
      color: "text-[#ff914d]",
    },
    {
      label: "New This Week",
      value: newThisWeek,
      icon: UserPlus,
      color: "text-[#ff914d]",
    },
    {
      label: "Hot Leads",
      value: hotLeads,
      icon: Flame,
      color: "text-[#ff914d]",
    },
    {
      label: "SMS / Web Chat",
      value: `${smsCount} / ${webChatCount}`,
      icon: Phone,
      secondIcon: MessageCircle,
      color: "text-[#ff914d]",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`p-5 ${glassCard}`}
        >
          <div className="flex items-center gap-3">
            <div className={`p-2.5 ${orangeAccentIcon}`}>
              <stat.icon className={`h-5 w-5 ${stat.color}`} />
            </div>
            <div>
              <p className={`text-sm ${textSecondary}`}>{stat.label}</p>
              <p className={`text-2xl font-semibold ${textPrimary}`}>
                {stat.value}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
