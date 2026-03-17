'use client';

import { useState } from 'react';
import { MessageSquare, Users, Zap, Mail, ArrowRight, Settings, CreditCard, Flame, Phone, X, AlertTriangle } from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';
import type { Conversation, Contact } from '@/types/database';
import PhoneNumberSelector from '@/components/phone/PhoneNumberSelector';

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
}

const statCards = [
  { key: 'totalConversations' as const, label: 'Total Conversations', icon: MessageSquare, color: 'text-blue-600 bg-blue-100' },
  { key: 'activeConversations' as const, label: 'Active Conversations', icon: Zap, color: 'text-green-600 bg-green-100' },
  { key: 'totalContacts' as const, label: 'Total Contacts', icon: Users, color: 'text-purple-600 bg-purple-100' },
  { key: 'messagesThisWeek' as const, label: 'Messages This Week', icon: Mail, color: 'text-orange-600 bg-orange-100' },
];

export default function DashboardOverview({ stats, recentConversations, hotLeads, phoneNumber }: DashboardOverviewProps) {
  const hasData = stats.totalConversations > 0 || stats.totalContacts > 0;
  const [showPhoneModal, setShowPhoneModal] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  return (
    <div className="space-y-6">
      {/* Phone Number Banner */}
      {!phoneNumber && !bannerDismissed && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800">
              Your AI assistant doesn&apos;t have a phone number yet. Customers can&apos;t text you until you set one up.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowPhoneModal(true)}
              className="px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-md hover:bg-amber-700"
            >
              Set Up Phone Number
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              className="p-1 text-amber-400 hover:text-amber-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.key} className="bg-white rounded-lg border border-gray-200 p-5">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${card.color}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">{stats[card.key]}</p>
                  <p className="text-sm text-gray-500">{card.label}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Phone Number Active Card */}
      {phoneNumber && (
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg text-green-600 bg-green-100">
              <Phone className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm text-gray-500">Your AI Number</p>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  Active
                </span>
              </div>
              <p className="text-lg font-bold text-gray-900">{phoneNumber}</p>
              <p className="text-xs text-gray-400">Customers can text this number 24/7</p>
            </div>
          </div>
        </div>
      )}

      {!hasData ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No conversations yet!</h3>
          <p className="text-sm text-gray-500 max-w-md mx-auto">
            Once you set up your phone number and customers start texting, your dashboard will come alive.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Conversations */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900">Recent Conversations</h3>
              <Link href="/conversations" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {recentConversations.length === 0 ? (
              <p className="text-sm text-gray-500 p-4">No conversations yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {recentConversations.map((conv) => (
                  <div key={conv.id} className="p-4 hover:bg-gray-50">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-gray-900">
                        {conv.contact?.name || conv.contact?.phone_number || 'Unknown'}
                      </p>
                      <span className="text-xs text-gray-400">
                        {formatDate(new Date(conv.last_message_at), 'MMM d, h:mm a')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        conv.channel === 'sms' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                      }`}>
                        {conv.channel === 'sms' ? 'SMS' : 'Web'}
                      </span>
                      {conv.lastMessage && (
                        <p className="text-xs text-gray-500 truncate">{conv.lastMessage}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Hot Leads */}
          <div className="bg-white rounded-lg border border-gray-200">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" /> Hot Leads
              </h3>
              <Link href="/contacts" className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1">
                View all <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            {hotLeads.length === 0 ? (
              <p className="text-sm text-gray-500 p-4">No hot leads yet. Contacts with a lead score of 7+ will appear here.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {hotLeads.map((lead) => (
                  <div key={lead.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{lead.name || lead.phone_number || 'Unknown'}</p>
                      <p className="text-xs text-gray-500">
                        Last contact: {formatDate(new Date(lead.last_contacted_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Flame className="w-3 h-3 text-orange-500" />
                      <span className="text-sm font-bold text-orange-600">{lead.lead_score}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/conversations"
            className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 text-sm font-medium"
          >
            <MessageSquare className="w-4 h-4" /> View All Conversations
          </Link>
          <Link
            href="/settings"
            className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 text-sm font-medium"
          >
            <Settings className="w-4 h-4" /> Manage AI Settings
          </Link>
          <Link
            href="/billing"
            className="flex items-center gap-2 px-4 py-2 bg-gray-50 text-gray-700 rounded-lg hover:bg-gray-100 text-sm font-medium"
          >
            <CreditCard className="w-4 h-4" /> View Billing
          </Link>
        </div>
      </div>

      {/* Phone Number Setup Modal */}
      {showPhoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Set Up Phone Number</h3>
              <button
                onClick={() => setShowPhoneModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Search for an available phone number and set it up for your AI assistant.
            </p>
            <PhoneNumberSelector />
          </div>
        </div>
      )}
    </div>
  );
}
