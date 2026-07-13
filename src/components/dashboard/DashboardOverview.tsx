'use client';

import { useState } from 'react';
import { MessageSquare, Users, Zap, Mail, ArrowRight, Cog, CreditCard, Flame, Phone, X, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import type { Conversation, Contact } from '@/types/database';
import PhoneNumberSelector from '@/components/phone/PhoneNumberSelector';
import A2pStatusCard, { type A2pStatusCardProps } from '@/components/dashboard/A2pStatusCard';
import { orangeAccentIcon } from '@/lib/glass';
import { card as cardSurface, ink, body, statusSuccess, statusInfo } from '@/lib/theme-v2/theme';

interface DashboardStats {
  totalConversations: number;
  activeConversations: number;
  totalContacts: number;
  messagesThisWeek: number;
}

interface RecentConversation extends Conversation {
  contact?: { name: string | null; phone_number: string | null } | null;
  lastMessage?: string;
}

interface DashboardOverviewProps {
  stats: DashboardStats;
  recentConversations: RecentConversation[];
  hotLeads: Contact[];
  phoneNumber: string | null;
  a2pStatus: A2pStatusCardProps;
}

const statCards = [
  { key: 'totalConversations' as const, label: 'Total Conversations', icon: MessageSquare, badge: '0 today', badgeColor: 'bg-[#fdf1e7] text-[#c2410c] border border-[#f5dcc4] dark:bg-[rgba(255,145,77,.14)] dark:text-[#ffd5bc] dark:border-[rgba(255,145,77,.22)]' },
  { key: 'activeConversations' as const, label: 'Active Conversations', icon: Zap, badge: 'Live', badgeColor: statusSuccess },
  { key: 'totalContacts' as const, label: 'Total Contacts', icon: Users, badge: 'CRM', badgeColor: 'bg-[#fdf1e7] text-[#c2410c] border border-[#f5dcc4] dark:bg-[rgba(255,145,77,.14)] dark:text-[#ffd5bc] dark:border-[rgba(255,145,77,.22)]' },
  { key: 'messagesThisWeek' as const, label: 'Messages Sent', icon: Mail, badge: 'This week', badgeColor: statusInfo },
];

/** Layered illustration: large gray circle + dashed chat bubble + overlapping phone badge */
function EmptyConversationsIllustration() {
  return (
    <div className="relative mx-auto mb-8 sm:mb-10 h-36 w-36 sm:h-44 sm:w-44">
      <div className="flex h-32 w-32 items-center justify-center rounded-full bg-stone-100 sm:h-40 sm:w-40 dark:bg-white/[0.07]">
        <svg
          viewBox="0 0 100 100"
          className="h-[50%] w-[50%] text-stone-400 dark:text-stone-500"
          fill="none"
          aria-hidden
        >
          <path
            d="M22 28h56a6 6 0 0 1 6 6v32a6 6 0 0 1-6 6H48l-14 12v-12H22a6 6 0 0 1-6-6V34a6 6 0 0 1 6-6z"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="5 5"
          />
        </svg>
      </div>
      <div
        className="absolute -bottom-0.5 -right-0.5 flex h-14 w-14 items-center justify-center rounded-full border border-[#ece4d8] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.1)] sm:h-16 sm:w-16 dark:border-white/[0.12] dark:bg-[#1c1c1f] dark:shadow-[0_12px_40px_rgba(0,0,0,0.45)]"
      >
        <Phone className="h-6 w-6 text-[#c2410c] dark:text-[#ff914d] sm:h-7 sm:w-7" strokeWidth={1.75} />
      </div>
    </div>
  );
}

export default function DashboardOverview({ stats, recentConversations, hotLeads, phoneNumber, a2pStatus }: DashboardOverviewProps) {
  const hasData = stats.totalConversations > 0 || stats.totalContacts > 0;
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  return (
    <div className="space-y-6">
      {/* Phone Number Banner */}
      {!phoneNumber && !bannerDismissed && (
        <div className={`p-4 ${cardSurface}`}>
          <div className="flex items-start gap-3">
            <div className={`p-2 shrink-0 ${orangeAccentIcon}`}>
              <AlertTriangle className="w-5 h-5 text-[#c2410c] dark:text-[#ff914d]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-medium ${ink}`}>
                Your AI assistant doesn&apos;t have a phone number yet. Customers can&apos;t text you until you set one up.
              </p>
            </div>
            <button
              onClick={() => setBannerDismissed(true)}
              className="p-1 text-stone-400 dark:text-[#bdbdbf] hover:text-stone-600 dark:hover:text-white shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="mt-3 sm:mt-0 sm:ml-11">
            <button
              onClick={() => setShowPhoneModal(true)}
              className="w-full sm:w-auto px-4 py-2 bg-[#ea580c] hover:bg-[#c2410c] active:bg-[#9a3412] text-white dark:bg-[#ff914d] dark:text-[#16100b] dark:hover:bg-[#f57f33] text-sm font-bold rounded-full transition-colors"
            >
              Set Up Phone Number
            </button>
          </div>
        </div>
      )}

      {/* A2P Registration Status */}
      <A2pStatusCard {...a2pStatus} />

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.key} className={`p-5 ${cardSurface}`}>
              <div className="flex items-center justify-between mb-3">
                <div className={`p-2 ${orangeAccentIcon}`}>
                  <Icon className="w-5 h-5 text-[#c2410c] dark:text-[#ff914d]" />
                </div>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold ${card.badgeColor}`}>
                  {card.badge}
                </span>
              </div>
              <p className={`text-sm ${body}`}>{card.label}</p>
              <p className={`text-3xl font-extrabold tracking-tight ${ink}`}>{stats[card.key]}</p>
            </div>
          );
        })}
      </div>

      {/* Phone Number Active Card */}
      {phoneNumber && (
        <div className={`p-5 ${cardSurface}`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 ${orangeAccentIcon}`}>
              <Phone className="w-5 h-5 text-[#c2410c] dark:text-[#ff914d]" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className={`text-sm ${body}`}>Your AI Number</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-[#fdf1e7] text-[#c2410c] border border-[#f5dcc4] dark:bg-[rgba(255,145,77,.14)] dark:text-[#ff914d] dark:border-[rgba(255,145,77,.22)]">
                  {a2pStatus.smsReady ? 'Active' : 'Setup pending'}
                </span>
              </div>
              <p className={`text-lg font-bold ${ink}`}>{phoneNumber}</p>
              <p className="text-xs text-stone-400 dark:text-[#888]">
                {a2pStatus.smsReady
                  ? 'Customers can text this number 24/7'
                  : 'SMS unlocks once carrier approval and number assignment are complete'}
              </p>
            </div>
          </div>
        </div>
      )}

      {!hasData ? (
        <div
          className={`
            ${cardSurface}
            px-6 py-10 text-center
            sm:px-10 sm:py-12 lg:px-12 lg:py-14
          `}
        >
          <EmptyConversationsIllustration />
          <h3 className={`text-xl font-bold tracking-tight sm:text-2xl mb-3 ${ink}`}>
            No conversations yet!
          </h3>
          <p className={`mx-auto max-w-md text-sm leading-relaxed sm:text-base ${body}`}>
            Once you set up your phone number and customers start texting, your dashboard will come alive.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Conversations */}
          <div className={`overflow-hidden ${cardSurface}`}>
            <div className="flex items-center justify-between p-4 border-b border-[#ece4d8] dark:border-white/[0.10]">
              <h3 className={`font-semibold ${ink}`}>Recent Conversations</h3>
              <Link href="/conversations" className="text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a] flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {recentConversations.length === 0 ? (
              <p className={`text-sm p-4 ${body}`}>No conversations yet.</p>
            ) : (
              <div className="divide-y divide-[#ece4d8] dark:divide-white/[0.06]">
                {recentConversations.map((conv) => (
                  <div key={conv.id} className="p-4 hover:bg-[#faf6ef] dark:hover:bg-white/[0.04] transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <p className={`text-sm font-medium ${ink}`}>
                        {conv.contact?.name || conv.contact?.phone_number || 'Unknown'}
                      </p>
                      <span className="text-xs text-stone-400 dark:text-[#888]">
                        {formatDate(new Date(conv.last_message_at), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        conv.channel === 'sms'
                          ? statusInfo
                          : statusSuccess
                      }`}>
                        {conv.channel === 'sms' ? 'SMS' : 'Web'}
                      </span>
                      {conv.lastMessage && (
                        <p className={`text-xs truncate ${body}`}>{conv.lastMessage}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Hot Leads */}
          <div className={`overflow-hidden ${cardSurface}`}>
            <div className="flex items-center justify-between p-4 border-b border-[#ece4d8] dark:border-white/[0.10]">
              <h3 className={`font-semibold flex items-center gap-2 ${ink}`}>
                <Flame className="w-4 h-4 text-[#c2410c] dark:text-[#ff914d]" /> Hot Leads
              </h3>
              <Link href="/contacts" className="text-sm text-[#c2410c] hover:text-[#9a3412] dark:text-[#ff914d] dark:hover:text-[#ffb07a] flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {hotLeads.length === 0 ? (
              <p className={`text-sm p-4 ${body}`}>No hot leads yet. Contacts with a lead score of 7+ will appear here.</p>
            ) : (
              <div className="divide-y divide-[#ece4d8] dark:divide-white/[0.06]">
                {hotLeads.map((lead) => (
                  <div key={lead.id} className="p-4 flex items-center justify-between hover:bg-[#faf6ef] dark:hover:bg-white/[0.04] transition-colors">
                    <div>
                      <p className={`text-sm font-medium ${ink}`}>{lead.name || lead.phone_number || 'Unknown'}</p>
                      <p className={`text-xs ${body}`}>
                        Last contact: {formatDate(new Date(lead.last_contacted_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Flame className="w-3 h-3 text-[#c2410c] dark:text-[#ff914d]" />
                      <span className="text-sm font-bold text-[#c2410c] dark:text-[#ff914d]">{lead.lead_score}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions — large floating panel + round cards */}
      <section
        className={`
          rounded-[28px] p-8 sm:p-10 lg:p-11
          bg-[#f3ece1] dark:bg-[rgba(22,22,26,0.92)]
          border border-[#e7ddcd] dark:border-white/[0.10]
          shadow-[0_24px_80px_rgba(0,0,0,0.06)] dark:shadow-[0_28px_90px_rgba(0,0,0,0.45)]
          backdrop-blur-[20px]
        `}
      >
        <h3 className={`text-xl sm:text-2xl font-bold tracking-tight mb-2 ${ink}`}>
          Quick Actions
        </h3>
        <p className={`text-sm sm:text-base mb-8 sm:mb-10 max-w-2xl ${body}`}>
          Clean, modern shortcuts for the most important tasks.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
          <Link
            href="/conversations"
            className="group relative block rounded-[22px] p-6 sm:p-7 pt-14 sm:pt-16
              bg-white dark:bg-[rgba(30,30,34,0.88)]
              border border-[#ece4d8] dark:border-white/[0.10]
              shadow-sm dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)]
              transition-all duration-300 ease-out
              hover:border-[#ea580c]/35 dark:hover:border-[rgba(255,145,77,0.28)]
              hover:-translate-y-1 hover:shadow-md dark:hover:shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
          >
            <div
              className={`absolute top-5 right-5 p-2.5 ${orangeAccentIcon}`}
            >
              <MessageSquare className="w-5 h-5 text-[#c2410c] dark:text-[#ff914d]" />
            </div>
            <h4 className={`text-base sm:text-lg font-semibold mb-2 pr-2 ${ink}`}>
              View Conversations
            </h4>
            <p className={`text-sm leading-relaxed ${body}`}>
              Review all active and historical conversations in one place.
            </p>
          </Link>
          <Link
            href="/settings"
            className="group relative block rounded-[22px] p-6 sm:p-7 pt-14 sm:pt-16
              bg-white dark:bg-[rgba(30,30,34,0.88)]
              border border-[#ece4d8] dark:border-white/[0.10]
              shadow-sm dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)]
              transition-all duration-300 ease-out
              hover:border-[#ea580c]/35 dark:hover:border-[rgba(255,145,77,0.28)]
              hover:-translate-y-1 hover:shadow-md dark:hover:shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
          >
            <div
              className={`absolute top-5 right-5 p-2.5 ${orangeAccentIcon}`}
            >
              <Cog className="w-5 h-5 text-[#c2410c] dark:text-[#ff914d]" />
            </div>
            <h4 className={`text-base sm:text-lg font-semibold mb-2 pr-2 ${ink}`}>
              Settings
            </h4>
            <p className={`text-sm leading-relaxed ${body}`}>
              Tune tone, greetings, and guardrails so your assistant sounds like your brand.
            </p>
          </Link>
          <Link
            href="/billing"
            className="group relative block rounded-[22px] p-6 sm:p-7 pt-14 sm:pt-16
              bg-white dark:bg-[rgba(30,30,34,0.88)]
              border border-[#ece4d8] dark:border-white/[0.10]
              shadow-sm dark:shadow-[0_12px_40px_rgba(0,0,0,0.35)]
              transition-all duration-300 ease-out
              hover:border-[#ea580c]/35 dark:hover:border-[rgba(255,145,77,0.28)]
              hover:-translate-y-1 hover:shadow-md dark:hover:shadow-[0_20px_50px_rgba(0,0,0,0.45)]"
          >
            <div
              className={`absolute top-5 right-5 p-2.5 ${orangeAccentIcon}`}
            >
              <CreditCard className="w-5 h-5 text-[#c2410c] dark:text-[#ff914d]" />
            </div>
            <h4 className={`text-base sm:text-lg font-semibold mb-2 pr-2 ${ink}`}>
              Billing
            </h4>
            <p className={`text-sm leading-relaxed ${body}`}>
              Manage your plan, payment method, and subscription details.
            </p>
          </Link>
        </div>
      </section>

      {/* Phone Number Setup Modal */}
      {showPhoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 dark:bg-black/60">
          <div className={`${cardSurface} w-full max-w-lg mx-4 p-6`}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${ink}`}>Set Up Phone Number</h3>
              <button
                onClick={() => setShowPhoneModal(false)}
                className="p-1 text-stone-400 dark:text-[#bdbdbf] hover:text-stone-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className={`text-sm mb-4 ${body}`}>
              Search for an available phone number and set it up for your AI assistant.
            </p>
            <PhoneNumberSelector />
          </div>
        </div>
      )}
    </div>
  );
}
