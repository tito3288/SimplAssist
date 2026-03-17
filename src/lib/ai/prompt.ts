import type {
  Business,
  AISettings,
  Service,
  FAQ,
  BusinessHours,
  Message,
} from "@/types/database";

const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function isCurrentlyOpen(
  businessHours: BusinessHours[],
  timezone: string
): { open: boolean; todayHours: string } {
  const now = new Date(
    new Date().toLocaleString("en-US", { timeZone: timezone })
  );
  const dayOfWeek = now.getDay();
  const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

  const todayEntry = businessHours.find((h) => h.day_of_week === dayOfWeek);

  if (!todayEntry || todayEntry.is_closed) {
    return { open: false, todayHours: "Closed today" };
  }

  const open = currentTime >= todayEntry.open_time && currentTime < todayEntry.close_time;
  return {
    open,
    todayHours: `${todayEntry.open_time} - ${todayEntry.close_time}`,
  };
}

function formatHoursSchedule(businessHours: BusinessHours[]): string {
  return businessHours
    .sort((a, b) => a.day_of_week - b.day_of_week)
    .map((h) => {
      const day = DAY_NAMES[h.day_of_week];
      if (h.is_closed) return `${day}: Closed`;
      return `${day}: ${h.open_time} - ${h.close_time}`;
    })
    .join("\n");
}

function getToneInstructions(tone: string): string {
  switch (tone) {
    case "friendly":
      return "Use a warm, casual, and approachable tone. Be enthusiastic and personable.";
    case "professional":
      return "Use a polished, formal, and courteous tone. Be respectful and businesslike.";
    case "balanced":
    default:
      return "Use a warm but professional tone. Be approachable yet polished.";
  }
}

export function buildSystemPrompt(
  business: Business,
  aiSettings: AISettings,
  services: Service[],
  faqs: FAQ[],
  businessHours: BusinessHours[]
): string {
  const { open, todayHours } = isCurrentlyOpen(businessHours, business.timezone);
  const nameRef =
    aiSettings.business_voice === "we" ? "we" : business.name;

  const sections: string[] = [];

  sections.push(
    `You are the virtual assistant for ${business.name}, a ${business.business_type} business.`
  );

  if (business.address) {
    sections.push(`Address: ${business.address}${business.city ? `, ${business.city}` : ""}${business.state ? `, ${business.state}` : ""} ${business.zip ?? ""}`);
  }
  if (business.phone_number) {
    sections.push(`Phone: ${business.phone_number}`);
  }

  sections.push("");
  sections.push("BUSINESS HOURS:");
  sections.push(formatHoursSchedule(businessHours));
  sections.push(`Today: ${todayHours}`);
  sections.push(`Currently: ${open ? "OPEN" : "CLOSED"}`);

  if (services.length > 0) {
    sections.push("");
    sections.push("SERVICES:");
    services.forEach((s) => {
      let line = `- ${s.name}`;
      if (s.description) line += `: ${s.description}`;
      if (s.price) line += ` ($${s.price})`;
      sections.push(line);
    });
  }

  if (faqs.length > 0) {
    sections.push("");
    sections.push("FREQUENTLY ASKED QUESTIONS:");
    faqs.forEach((f) => {
      sections.push(`Q: ${f.question}`);
      sections.push(`A: ${f.answer}`);
    });
  }

  sections.push("");
  sections.push("TONE AND STYLE:");
  sections.push(getToneInstructions(aiSettings.tone));
  sections.push(
    `When referring to the business, use "${nameRef}" (e.g., "${nameRef} offer..." or "${nameRef} can help...").`
  );

  if (aiSettings.language === "es") {
    sections.push("Respond in Spanish.");
  } else if (aiSettings.language === "both") {
    sections.push("Respond in the same language the customer uses. You can communicate in both English and Spanish.");
  }

  if (aiSettings.guardrails.length > 0) {
    sections.push("");
    sections.push("STRICT RULES:");
    aiSettings.guardrails.forEach((g) => {
      sections.push(`- DO NOT ${g}`);
    });
  }

  sections.push("");
  sections.push("BOOKING:");
  if (aiSettings.booking_enabled) {
    if (aiSettings.booking_mode === "collect_info") {
      sections.push(
        "When a customer wants to book, collect their name, preferred date/time, and service needed. Let them know someone will confirm their appointment."
      );
    } else {
      sections.push(
        "When a customer wants to book, help them schedule directly by collecting their name, preferred date/time, and service needed."
      );
    }
  } else {
    sections.push(
      "Booking is not currently available. If a customer asks to book, suggest they call during business hours."
    );
  }

  sections.push("");
  sections.push("GENERAL INSTRUCTIONS:");
  sections.push("- Be helpful and concise. This is an SMS/chat conversation — keep responses short, ideally under 160 characters when possible.");
  sections.push("- Do NOT use markdown formatting (no **, ##, bullets with *, etc.).");
  sections.push("- Do NOT make up information that is not provided in this context.");
  sections.push("- If you are unsure about something, suggest the customer call during business hours.");
  sections.push("- Stay in character as the business's virtual assistant at all times.");
  sections.push("- Never reveal that you are an AI unless directly asked.");

  return sections.join("\n");
}

export function buildConversationMessages(
  history: Message[],
  newMessage: string
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  const recent = history.slice(-20);

  for (const msg of recent) {
    if (msg.role === "customer") {
      messages.push({ role: "user", content: msg.content });
    } else if (msg.role === "assistant") {
      messages.push({ role: "assistant", content: msg.content });
    }
  }

  messages.push({ role: "user", content: newMessage });

  return messages;
}
