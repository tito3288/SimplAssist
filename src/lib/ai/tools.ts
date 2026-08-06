import type { AISettings } from "@/types/database";
import type Anthropic from "@anthropic-ai/sdk";

export const CREATE_BOOKING_START_TIME_CONTRACT =
  "create_booking.start_time must be a business-local wall time in exactly YYYY-MM-DDTHH:mm:ss format with NO Z suffix or UTC offset.";

export const calendarTools: Anthropic.Tool[] = [
  {
    name: "check_availability",
    description:
      "Check available appointment slots on the business calendar for a specific date. Use this when a customer wants to book an appointment and you need to show them available times.",
    input_schema: {
      type: "object" as const,
      properties: {
        date: {
          type: "string",
          description:
            "The date to check availability for, in YYYY-MM-DD format",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "create_booking",
    description:
      "Create a confirmed appointment on the business calendar. Use this only after the customer has confirmed a specific time slot, and you have collected their name and the service they want.",
    input_schema: {
      type: "object" as const,
      properties: {
        customer_name: {
          type: "string",
          description: "The customer's full name",
        },
        customer_phone: {
          type: "string",
          description: "The customer's phone number",
        },
        customer_email: {
          type: "string",
          description: "The customer's email (optional)",
        },
        service_name: {
          type: "string",
          description: "The service being booked",
        },
        start_time: {
          type: "string",
          description: CREATE_BOOKING_START_TIME_CONTRACT,
        },
        duration_minutes: {
          type: "number",
          description: "Duration in minutes, default 30",
        },
      },
      required: ["customer_name", "service_name", "start_time"],
    },
  },
];

export function shouldIncludeCalendarTools(
  aiSettings: AISettings,
  hasCalendarConnected: boolean,
  bookingOperationallyAvailable: boolean = true
): boolean {
  return (
    bookingOperationallyAvailable &&
    aiSettings.booking_enabled &&
    aiSettings.booking_mode === "schedule_direct" &&
    hasCalendarConnected
  );
}
