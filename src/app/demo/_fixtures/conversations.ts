/**
 * Conversation fixtures for /demo/conversations — a busy afternoon at Manny's
 * Plumbing. 14 conversations across SMS + web chat covering every UI state:
 * AI-handled, human takeover (unread dots on exactly the threads a human
 * SHOULD grab), handed-off, closed, an anonymous web visitor, and a
 * phone-only contact.
 *
 * Rules the real inbox derives its UI from (keep these invariants):
 * - `last_message_preview` === the final fixture message's content, verbatim.
 * - `started_at` < first message < `last_message_at` === final message time.
 * - Unread dot = status "active" && !is_ai_handling.
 *
 * Thread #1 (Sarah Mitchell) is pre-selected on the demo page: the complete
 * missed-call → AI reply → booked arc, ending with the system pill that the
 * /demo/calendar fixtures pick up ("Water heater repair - Sarah M.", Tue 9AM).
 */

import type { Channel, ConversationStatus, Message, MessageRole } from "@/types/database";
import type { ConversationWithContact } from "@/app/(dashboard)/conversations/page";
import { DEMO_BUSINESS } from "./business";
import { minutesAgo } from "./dates";

/** [minutesBeforeNow, role, content] — last entry drives preview + last_message_at. */
type ScriptLine = [number, MessageRole, string];

type ConvSpec = {
  id: string;
  channel: Channel;
  status: ConversationStatus;
  ai: boolean;
  contact: { name: string | null; phone: string | null; email?: string | null };
  script: ScriptLine[];
};

function build(now: Date, specs: ConvSpec[]) {
  const conversations: ConversationWithContact[] = [];
  const messagesById: Record<string, Message[]> = {};

  specs.forEach((spec, index) => {
    const contactId = `demo-contact-${String(index + 1).padStart(2, "0")}`;
    const first = spec.script[0][0];
    const last = spec.script[spec.script.length - 1][0];

    messagesById[spec.id] = spec.script.map(([mins, role, content], i) => ({
      id: `${spec.id}-m${i + 1}`,
      conversation_id: spec.id,
      business_id: DEMO_BUSINESS.businessId,
      role,
      content,
      channel: spec.channel,
      created_at: minutesAgo(now, mins),
    })) as Message[];

    conversations.push({
      id: spec.id,
      business_id: DEMO_BUSINESS.businessId,
      contact_id: contactId,
      channel: spec.channel,
      status: spec.status,
      is_ai_handling: spec.ai,
      started_at: minutesAgo(now, first + 1),
      last_message_at: minutesAgo(now, last),
      contact: {
        id: contactId,
        name: spec.contact.name,
        phone_number: spec.contact.phone,
        email: spec.contact.email ?? null,
      },
      last_message_preview: spec.script[spec.script.length - 1][2],
    } as ConversationWithContact);
  });

  return { conversations, messagesById };
}

const H = 60;
const D = 24 * 60;

export function buildConversationFixtures(now: Date) {
  return build(now, [
    {
      // #1 — the hero-demo story continued: pre-selected on the demo page
      id: "demo-conv-01",
      channel: "sms",
      status: "active",
      ai: true,
      contact: { name: "Sarah Mitchell", phone: "5125550134" },
      script: [
        [48, "system", "Missed call from (512) 555-0134 — AI assistant is texting back"],
        [48, "assistant", "Hi, this is the assistant at Manny's Plumbing! Sorry we missed your call — how can we help today?"],
        [45, "customer", "Hi — my water heater is leaking all over the garage floor. Can someone come out this week?"],
        [44, "assistant", "Sorry to hear that, and yes — we can help. For a water heater repair we have Tuesday at 9:00 AM or Wednesday at 2:00 PM open. Which works better?"],
        [38, "customer", "Tuesday morning works. How much is the service call?"],
        [37, "assistant", "Our diagnostic visit is $89, and it's applied toward the repair if you move forward. Want me to lock in Tuesday at 9:00 AM?"],
        [9, "customer", "Yes please, book it."],
        [7, "assistant", "You're all set for Tuesday at 9:00 AM ✅ You'll get a reminder text the day before."],
        [7, "system", "Appointment booked: Water heater repair — Tue 9:00 AM. Added to Google Calendar."],
      ],
    },
    {
      id: "demo-conv-02",
      channel: "web_chat",
      status: "active",
      ai: true,
      contact: { name: "Dan Kowalski", phone: null, email: "dan.k@gmail.com" },
      script: [
        [41, "customer", "Hey, do you guys service tankless water heaters? Mine's due for a flush."],
        [40, "assistant", "We do! An annual flush keeps the warranty valid too. We have Thursday at 2:00 PM or Friday at 10:30 AM open — want one of those?"],
        [28, "customer", "Thursday works."],
        [26, "assistant", "Great — you're booked for a tankless water heater flush Thursday at 2:00 PM."],
      ],
    },
    {
      // #3 — urgent + unanswered: exactly why the unread dot exists
      id: "demo-conv-03",
      channel: "sms",
      status: "active",
      ai: false,
      contact: { name: null, phone: "5125550119" },
      script: [
        [52, "system", "Missed call from (512) 555-0119 — AI assistant is texting back"],
        [52, "assistant", "Hi, this is the assistant at Manny's Plumbing! Sorry we missed your call — how can we help today?"],
        [48, "customer", "There's water coming through the kitchen ceiling. How fast can someone get here?"],
      ],
    },
    {
      id: "demo-conv-04",
      channel: "sms",
      status: "active",
      ai: true,
      contact: { name: "Maria Gonzalez", phone: "5125550152" },
      script: [
        [2 * H + 20, "customer", "My kitchen sink is draining super slow again. Can I get someone out?"],
        [2 * H + 18, "assistant", "We can take care of that. For a drain cleaning we have tomorrow at 8:30 AM or 1:00 PM — which do you prefer?"],
        [2 * H + 4, "customer", "8:30 works great"],
        [2 * H, "assistant", "Perfect — you're booked for a drain cleaning tomorrow at 8:30 AM."],
      ],
    },
    {
      // #5 — price negotiation: the other unread dot
      id: "demo-conv-05",
      channel: "web_chat",
      status: "active",
      ai: false,
      contact: { name: "Rob Jensen", phone: "5125550171" },
      script: [
        [3 * H + 30, "customer", "I got your estimate for the whole-house repipe. It's close but another company came in lower."],
        [3 * H + 28, "assistant", "Thanks for letting us know, Rob. I'll flag this for the owner so a real person can talk pricing with you."],
        [3 * H, "customer", "Can you match the repipe quote I got last week? Happy to email it over."],
      ],
    },
    {
      id: "demo-conv-06",
      channel: "sms",
      status: "active",
      ai: true,
      contact: { name: "Priya Patel", phone: "5125550146" },
      script: [
        [26 * H, "customer", "Hi, I think we have a slab leak — our water bill doubled this month."],
        [26 * H - 2, "assistant", "That's a common sign of one. Let's get a leak detection visit scheduled — we have tomorrow between 1:00–3:00 PM. Does that work?"],
        [25 * H, "customer", "Yes, that works."],
        [5 * H, "assistant", "Reminder: your leak detection visit is tomorrow between 1:00–3:00 PM."],
      ],
    },
    {
      id: "demo-conv-07",
      channel: "web_chat",
      status: "active",
      ai: true,
      contact: { name: "Tom Callahan", phone: null },
      script: [
        [7 * H + 10, "customer", "Do you install garbage disposals? Mine died this morning."],
        [7 * H, "assistant", "Yes — we install and service garbage disposals. Want me to check availability?"],
      ],
    },
    {
      // #8 — handed off; shows the dark human_agent bubble style
      id: "demo-conv-08",
      channel: "sms",
      status: "handed_off",
      ai: false,
      contact: { name: "Linda Okafor", phone: "5125550188" },
      script: [
        [27 * H, "customer", "The bathroom faucet you installed last month is dripping again. Not thrilled."],
        [27 * H - 2, "assistant", "Sorry about that, Linda — that shouldn't happen. I'm looping in the owner to make this right."],
        [26 * H + 30, "human_agent", "Hi Linda, Mike here — sorry about the drip. I'll come take a look Friday at 8, no charge."],
        [26 * H, "customer", "Thanks Mike! See you Friday morning."],
      ],
    },
    {
      id: "demo-conv-09",
      channel: "sms",
      status: "active",
      ai: true,
      contact: { name: "James Whitfield", phone: "5125550163" },
      script: [
        [30 * H + 5, "customer", "What do you charge just to come out and look at a running toilet?"],
        [30 * H, "assistant", "Our diagnostic visit is $89, and it's applied toward any repair."],
      ],
    },
    {
      id: "demo-conv-10",
      channel: "web_chat",
      status: "active",
      ai: true,
      contact: { name: "Emily Tran", phone: null, email: "emily.tran@utexas.edu" },
      script: [
        [34 * H, "customer", "Hi! Could I get a quote for a water softener install? It's a 3-bed house."],
        [33 * H + 30, "assistant", "Happy to help — for a 3-bedroom home we typically recommend a 40,000-grain unit. What's the best email for the estimate?"],
        [33 * H + 10, "customer", "emily.tran@utexas.edu"],
        [33 * H, "assistant", "I've sent the water softener estimate to your email — let me know!"],
      ],
    },
    {
      id: "demo-conv-11",
      channel: "sms",
      status: "closed",
      ai: true,
      contact: { name: "Carlos Reyes", phone: "5125550107" },
      script: [
        [2 * D + 2 * H, "customer", "Faucet's working perfectly now. Thanks for the quick turnaround!"],
        [2 * D, "assistant", "Glad we could help! If anything comes up, just text us here."],
      ],
    },
    {
      // #12 — anonymous late-night web visitor → renders "Unknown"
      id: "demo-conv-12",
      channel: "web_chat",
      status: "active",
      ai: true,
      contact: { name: null, phone: null },
      script: [
        [3 * D + H, "customer", "are you open on saturdays?"],
        [3 * D, "assistant", "We're open Mon–Sat, 7 AM–6 PM. After-hours emergency service is available."],
      ],
    },
    {
      id: "demo-conv-13",
      channel: "sms",
      status: "active",
      ai: true,
      contact: { name: "Angela Brooks", phone: "5125550195" },
      script: [
        [4 * D + 2 * H, "customer", "We keep getting sewage smell in the backyard. Neighbor said you did their sewer scope?"],
        [4 * D + 2 * H - 3, "assistant", "That smell usually means it's worth a look. A sewer camera inspection is $249 — we have Monday at 11:00 AM open. Want it?"],
        [4 * D + H, "customer", "Yes, let's do Monday."],
        [4 * D, "assistant", "You're booked for a sewer camera inspection Monday at 11:00 AM."],
      ],
    },
    {
      id: "demo-conv-14",
      channel: "web_chat",
      status: "closed",
      ai: false,
      contact: { name: "Frank DeLuca", phone: "5125550122" },
      script: [
        [5 * D + H, "customer", "I need to cancel Thursday's visit — we're out of town that week."],
        [5 * D, "human_agent", "No problem — Thursday's visit is canceled. Thanks for the heads-up!"],
      ],
    },
  ]);
}
