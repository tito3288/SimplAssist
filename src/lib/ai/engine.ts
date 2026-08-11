import { createHash } from "node:crypto";
import { anthropic } from "@/lib/anthropic/client";
import {
  isOperationalControlsResolutionError,
  resolveBusinessOperationalControls,
  resolveOperationalBlockReason,
} from "@/lib/account/operationalControls.server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  canUseFeature,
  EntitlementResolutionError,
  resolveBusinessEntitlements,
} from "@/lib/billing/entitlements";
import { findOrCreateContact, incrementLeadScore, updateContactName, updateContactEmail } from "./contacts";
import {
  getOrCreateConversation,
  addMessage,
  getConversationAiState,
  getConversationHistory,
  isAiHandlingActive,
} from "./conversations";
import {
  parseKnowledgeGapSignal,
  stripExactKnowledgeGapSignal,
} from "./knowledgeGapSignal";
import type { ParsedKnowledgeGapSignal } from "./knowledgeGapSignal";
import { buildSystemPrompt, buildConversationMessages } from "./prompt";
import { recordBookingRequest } from "./bookingRequests";
import {
  bookingRequestTools,
  calendarTools,
  shouldIncludeBookingRequestTools,
  shouldIncludeCalendarTools,
  signupGoalTools,
} from "./tools";
import { checkAvailability, createBooking } from "@/lib/google/calendar";
import {
  isBookingOperationalBlockedError,
  isBookingOperationalStateError,
} from "@/lib/google/bookingOperational.server";
import type {
  Business,
  AISettings,
  Service,
  FAQ,
  BusinessHours,
  Channel,
  Contact,
  Conversation,
} from "@/types/database";
import type Anthropic from "@anthropic-ai/sdk";

const FALLBACK_MESSAGE =
  "Thanks for reaching out! We're having a brief technical issue. Please try again in a moment or call us directly.";

const BOOKING_UNAVAILABLE_TOOL_RESULT =
  "Booking is currently unavailable. Do not check availability, create an appointment, or collect booking details. Let the customer know booking is unavailable.";

const BOOKING_REQUEST_RECORDED_TOOL_RESULT =
  "Appointment request recorded for owner review. It is not a booked or confirmed appointment.";

const BOOKING_REQUEST_PREVIEW_TOOL_RESULT =
  "Preview only: no appointment request was created. Do not say it was recorded, booked, or confirmed.";

const BOOKING_REQUEST_UNAVAILABLE_TOOL_RESULT =
  "Appointment-request recording is not enabled for this business right now. Do not say a request was recorded, booked, or confirmed.";

const GOAL_LINK_IDEMPOTENCY_NAMESPACE = "goal-link-offered:v1";

export type AIProcessingBlockedReason =
  | "feature_not_entitled"
  | "conversation_in_manual_mode"
  | "account_suspended"
  | "ai_replies_paused"
  | "texting_paused";

const AI_PROCESSING_BLOCKED_MESSAGES: Record<
  AIProcessingBlockedReason,
  string
> = {
  feature_not_entitled:
    "AI processing is not included in this business's current plan.",
  conversation_in_manual_mode:
    "AI processing is disabled while this conversation is in Human mode.",
  account_suspended: "AI processing is unavailable for this account.",
  ai_replies_paused: "AI replies are currently paused for this account.",
  texting_paused: "AI SMS replies are currently paused for this account.",
};

export class AIProcessingBlockedError extends Error {
  constructor(readonly reason: AIProcessingBlockedReason) {
    super(AI_PROCESSING_BLOCKED_MESSAGES[reason]);
    this.name = "AIProcessingBlockedError";
  }
}

export class AIProcessingStateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AIProcessingStateError";
  }
}

function rethrowTypedAIProcessingError(error: unknown): void {
  if (isBookingOperationalBlockedError(error)) {
    if (error.reason === "account_suspended") {
      throw new AIProcessingBlockedError("account_suspended");
    }
    throw error;
  }
  if (isBookingOperationalStateError(error)) {
    throw new AIProcessingStateError(
      `Could not determine booking state for business ${error.businessId}.`,
      { cause: error }
    );
  }
  if (
    error instanceof AIProcessingBlockedError ||
    error instanceof AIProcessingStateError ||
    isOperationalControlsResolutionError(error)
  ) {
    throw error;
  }
}

export interface ProcessIncomingMessageOptions {
  persistAssistant?: boolean;
  /** Set false only for an authenticated, same-business widget preview. */
  persistBookingRequests?: boolean;
  /** Set false only when the caller has already durably stored this message. */
  persistCustomer?: boolean;
  /** Required with persistCustomer=false so booking actions remain retry-stable. */
  sourceMessageId?: string;
  contact?: Contact;
  conversation?: Conversation;
}

export interface ProcessIncomingMessageResult {
  text: string;
  knowledgeGapDetected: boolean;
  conversationId: string | null;
  sourceMessageId: string | null;
  actions: GoalLinkOfferedAction[];
  assistantMessageId: string | null;
}

export interface GoalLinkOfferedAction {
  kind: "goal_link_offered";
  goalAtEvent: "signup";
  channel: Channel;
  contactId: string;
  conversationId: string;
  sourceMessageId: string;
  idempotencyKey: string;
}

function buildGoalLinkIdempotencyKey(
  businessId: string,
  sourceMessageId: string
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        GOAL_LINK_IDEMPOTENCY_NAMESPACE,
        businessId,
        sourceMessageId,
      ]),
      "utf8"
    )
    .digest("base64url");
}

/**
 * Reads operational controls at an AI execution boundary. SMS generation
 * requires both texting and AI replies, while web chat requires only AI. The
 * resolver is intentionally uncached; uncertainty propagates as its retryable
 * typed error instead of becoming an allow decision or a fallback reply.
 */
async function assertAIProcessingOperationallyAllowed(
  businessId: string,
  channel: Channel
) {
  let controls;
  try {
    controls = await resolveBusinessOperationalControls(businessId);
  } catch (error) {
    if (isOperationalControlsResolutionError(error)) throw error;
    throw new AIProcessingStateError(
      `Could not determine operational controls for business ${businessId}.`,
      { cause: error }
    );
  }
  const reason = resolveOperationalBlockReason(
    controls,
    channel === "sms" ? ["texting", "ai_replies"] : ["ai_replies"]
  );

  if (reason === null) return controls;
  if (reason === "bookings_paused") {
    throw new AIProcessingStateError(
      "AI operational access returned an unexpected booking-only block."
    );
  }
  throw new AIProcessingBlockedError(reason);
}

function scoreMessage(message: string): number {
  const lower = message.toLowerCase();
  let score = 0;

  if (/\b(price|pricing|cost|how much|rate|fee|quote|cheap|cheapest|budget|afford|estimate|pay|payment)\b/.test(lower)) score += 2;
  if (/\b(book|booking|appointment|schedule|reserve|set up a time|consultation|meet|meeting|call|demo)\b/.test(lower)) score += 3;
  if (/\b(service|offer|provide|do you do|available|help me|need|looking for|interested)\b/.test(lower)) score += 1;

  return score;
}

const contactTools: Anthropic.Tool[] = [
  {
    name: "save_contact_name",
    description: "Save the customer's name to their contact record. Call this when the customer tells you their name.",
    input_schema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "The customer's name",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "save_contact_email",
    description: "Save the customer's email to their contact record. Call this when the customer provides their email address.",
    input_schema: {
      type: "object" as const,
      properties: {
        email: {
          type: "string",
          description: "The customer's email address",
        },
      },
      required: ["email"],
    },
  },
];

async function executeContactTool(
  contactId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<string> {
  try {
    if (toolName === "save_contact_name") {
      const name = toolInput.name as string;
      await updateContactName(contactId, name);
      return `Contact name saved: ${name}`;
    }
    if (toolName === "save_contact_email") {
      const email = toolInput.email as string;
      await updateContactEmail(contactId, email);
      return `Contact email saved: ${email}`;
    }
    return "Unknown tool.";
  } catch (error) {
    rethrowTypedAIProcessingError(error);
    console.error(`[contact-tool] Error executing ${toolName}:`, error);
    if (toolName === "save_contact_name") {
      return "Contact name could not be saved. Do not say it was saved; continue helping the customer.";
    }
    if (toolName === "save_contact_email") {
      return "Contact email could not be saved. Do not say it was saved; continue helping the customer.";
    }
    return "Contact info could not be saved. Do not say it was saved; continue helping the customer.";
  }
}

async function executeCalendarTool(
  businessId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  timezone: string,
  contactPhone: string | null,
  contactId: string,
  conversationId: string,
  sourceMessageId: string | null
): Promise<string> {
  try {
    if (toolName === "check_availability") {
      const date = toolInput.date as string;
      const slots = await checkAvailability(businessId, date, timezone);

      if (slots.length === 0) {
        return "No available slots on that date. The business may be closed or fully booked.";
      }

      return `Available times on ${date}: ${slots.join(", ")}`;
    }

    if (toolName === "create_booking") {
      if (!sourceMessageId) {
        throw new AIProcessingStateError(
          "Direct booking requires a durably persisted source message."
        );
      }
      const customerEmail = (toolInput.customer_email as string) || undefined;
      const result = await createBooking(
        businessId,
        {
          customerName: toolInput.customer_name as string,
          customerPhone: (toolInput.customer_phone as string) || contactPhone || undefined,
          customerEmail,
          serviceName: toolInput.service_name as string,
          startTime: toolInput.start_time as string,
          durationMinutes: (toolInput.duration_minutes as number) || 30,
        },
        timezone,
        {
          contactId,
          conversationId,
          sourceMessageId,
        }
      );

      // Save email to contact as a safety net
      if (customerEmail) {
        await updateContactEmail(contactId, customerEmail).catch(() => {});
      }

      return `Appointment booked successfully! ${result.summary} at ${result.startTime}. Event ID: ${result.eventId}`;
    }

    return "Unknown tool.";
  } catch (error) {
    if (isBookingOperationalBlockedError(error)) {
      if (error.reason === "account_suspended") {
        throw new AIProcessingBlockedError("account_suspended");
      }
      return BOOKING_UNAVAILABLE_TOOL_RESULT;
    }
    if (isBookingOperationalStateError(error)) {
      throw new AIProcessingStateError(
        `Could not determine booking state for business ${error.businessId}.`,
        { cause: error }
      );
    }
    rethrowTypedAIProcessingError(error);
    console.error(`[calendar-tool] Error executing ${toolName}:`, error);
    return "Calendar is temporarily unavailable. Please collect the customer's booking details instead and let them know someone will confirm.";
  }
}

interface BookingRequestContactSnapshot {
  id: string;
  business_id: string;
  name: string | null;
  phone_number: string | null;
  provided_phone_number: string | null;
  email: string | null;
}

interface BookingRequestToolExecutionResult {
  content: string;
  suppressCollectForFollowup: boolean;
}

function nonBlankToolText(
  value: unknown,
  fieldName: string
): string {
  if (typeof value !== "string" || !/\S/.test(value)) {
    throw new AIProcessingStateError(
      `Booking request tool returned invalid ${fieldName}.`
    );
  }
  return value;
}

function optionalNonBlankText(value: unknown): string | null {
  return typeof value === "string" && /\S/.test(value) ? value : null;
}

async function executeBookingRequestTool(args: {
  businessId: string;
  contactId: string;
  conversationId: string;
  sourceMessageId: string | null;
  toolInput: Record<string, unknown>;
  toolWasExposed: boolean;
  persistBookingRequests: boolean;
  channel: Channel;
}): Promise<BookingRequestToolExecutionResult> {
  const {
    businessId,
    contactId,
    conversationId,
    sourceMessageId,
    toolInput,
    toolWasExposed,
    persistBookingRequests,
    channel,
  } = args;

  let operationalControls;
  try {
    operationalControls = await assertAIProcessingOperationallyAllowed(
      businessId,
      channel
    );
  } catch (error) {
    if (
      error instanceof AIProcessingBlockedError ||
      error instanceof AIProcessingStateError
    ) {
      throw error;
    }
    throw new AIProcessingStateError(
      `Could not recheck booking-request operational controls for business ${businessId}.`,
      { cause: error }
    );
  }

  let businessResult;
  let aiSettingsResult;
  try {
    [businessResult, aiSettingsResult] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("primary_goal")
        .eq("id", businessId)
        .single(),
      supabaseAdmin
        .from("ai_settings")
        .select("booking_enabled,booking_mode")
        .eq("business_id", businessId)
        .single(),
    ]);
  } catch (error) {
    throw new AIProcessingStateError(
      `Could not recheck booking-request configuration for business ${businessId}.`,
      { cause: error }
    );
  }

  if (businessResult.error || aiSettingsResult.error) {
    throw new AIProcessingStateError(
      `Could not recheck booking-request configuration for business ${businessId}.`,
      { cause: businessResult.error ?? aiSettingsResult.error }
    );
  }

  const freshBusiness = businessResult.data as Pick<Business, "primary_goal"> | null;
  const freshAiSettings = aiSettingsResult.data as AISettings | null;
  if (!freshBusiness || !freshAiSettings) {
    throw new AIProcessingStateError(
      `Business ${businessId} is missing booking-request configuration.`
    );
  }

  const bookingRequestOperationallyAvailable =
    operationalControls.bookingsPausedAt === null;
  const freshBookingRequestToolAvailable =
    freshBusiness.primary_goal !== "signup" &&
    shouldIncludeBookingRequestTools(
      freshAiSettings,
      bookingRequestOperationallyAvailable
    );
  if (!toolWasExposed || !freshBookingRequestToolAvailable) {
    return {
      content: BOOKING_REQUEST_UNAVAILABLE_TOOL_RESULT,
      // If this turn really advertised collect-mode recording, do not
      // re-advertise stale collect prompt/tool state after a fresh rejection.
      // The turn-start goal/mode remains authoritative for all other surfaces.
      suppressCollectForFollowup:
        toolWasExposed && !freshBookingRequestToolAvailable,
    };
  }

  if (!sourceMessageId) {
    throw new AIProcessingStateError(
      "Appointment-request recording requires a durably persisted source message."
    );
  }

  const requestedService = nonBlankToolText(
    toolInput.requested_service,
    "requested_service"
  );
  const requestedTimeText = nonBlankToolText(
    toolInput.requested_time_text,
    "requested_time_text"
  );

  // Authenticated widget previews exercise the same prompt/tool contract but
  // deliberately stop before reading snapshots or creating a durable row.
  if (!persistBookingRequests) {
    return {
      content: BOOKING_REQUEST_PREVIEW_TOOL_RESULT,
      suppressCollectForFollowup: false,
    };
  }

  let contactResult;
  try {
    contactResult = await supabaseAdmin
      .from("contacts")
      .select(
        "id,business_id,name,phone_number,provided_phone_number,email"
      )
      .eq("id", contactId)
      .eq("business_id", businessId)
      .single();
  } catch (error) {
    throw new AIProcessingStateError(
      `Could not load the booking-request contact for business ${businessId}.`,
      { cause: error }
    );
  }

  const freshContact = contactResult.data as BookingRequestContactSnapshot | null;
  if (
    contactResult.error ||
    !freshContact ||
    freshContact.id !== contactId ||
    freshContact.business_id !== businessId
  ) {
    throw new AIProcessingStateError(
      `Could not load the booking-request contact for business ${businessId}.`,
      { cause: contactResult.error ?? undefined }
    );
  }

  const customerName =
    optionalNonBlankText(toolInput.customer_name) ??
    optionalNonBlankText(freshContact.name);
  const customerPhone =
    optionalNonBlankText(toolInput.customer_phone) ??
    optionalNonBlankText(freshContact.provided_phone_number) ??
    optionalNonBlankText(freshContact.phone_number);
  const customerEmail =
    optionalNonBlankText(toolInput.customer_email) ??
    optionalNonBlankText(freshContact.email);

  try {
    await recordBookingRequest({
      businessId,
      contactId,
      conversationId,
      sourceMessageId,
      requestedService,
      requestedTimeText,
      customerName,
      customerPhone,
      customerEmail,
    });
  } catch (error) {
    throw new AIProcessingStateError(
      `Could not record the appointment request for business ${businessId}.`,
      { cause: error }
    );
  }

  return {
    content: BOOKING_REQUEST_RECORDED_TOOL_RESULT,
    suppressCollectForFollowup: false,
  };
}

export async function processIncomingMessage(
  businessId: string,
  contactPhone: string | null,
  contactEmail: string | null,
  message: string,
  channel: Channel,
  sessionId: string | null = null,
  options: ProcessIncomingMessageOptions = {}
): Promise<string> {
  const result = await processIncomingMessageDetailed(
    businessId,
    contactPhone,
    contactEmail,
    message,
    channel,
    sessionId,
    options
  );

  return result.text;
}

export async function processIncomingMessageDetailed(
  businessId: string,
  contactPhone: string | null,
  contactEmail: string | null,
  message: string,
  channel: Channel,
  sessionId: string | null = null,
  options: ProcessIncomingMessageOptions = {}
): Promise<ProcessIncomingMessageResult> {
  try {
    await assertAIProcessingOperationallyAllowed(businessId, channel);

    // Resolve at the execution boundary even when an upstream webhook already
    // checked the plan. This closes the downgrade/cancel race before any
    // Anthropic request and avoids trusting a stale long-lived decision.
    const entitlements = await resolveBusinessEntitlements(businessId);
    const requiredFeature =
      channel === "sms" ? "ai_sms_conversations" : "web_chat";

    if (!canUseFeature(entitlements, requiredFeature)) {
      throw new AIProcessingBlockedError("feature_not_entitled");
    }

    let contact: Contact;
    try {
      contact =
        options.contact ??
        (await findOrCreateContact(
          businessId,
          contactPhone,
          contactEmail,
          channel,
          sessionId
        ));
    } catch (error) {
      throw new AIProcessingStateError(
        `Could not resolve a contact for business ${businessId}.`,
        { cause: error }
      );
    }

    if (contact.business_id !== businessId) {
      throw new AIProcessingStateError(
        `Contact ${contact.id} does not belong to business ${businessId}.`
      );
    }

    let conversation: Conversation;
    try {
      conversation =
        options.conversation ??
        (await getOrCreateConversation(businessId, contact.id, channel));
    } catch (error) {
      throw new AIProcessingStateError(
        `Could not resolve a conversation for contact ${contact.id}.`,
        { cause: error }
      );
    }

    if (
      conversation.business_id !== businessId ||
      conversation.contact_id !== contact.id ||
      conversation.channel !== channel
    ) {
      throw new AIProcessingStateError(
        `Conversation ${conversation.id} does not match the AI request context.`
      );
    }

    // Defense in depth: the webhook checks this before dispatching AI, and the
    // engine re-reads it so a human takeover that races processing still wins.
    if (channel === "sms") {
      let currentState: Pick<
        Conversation,
        "id" | "status" | "is_ai_handling"
      >;
      try {
        currentState = await getConversationAiState(conversation.id);
      } catch (error) {
        throw new AIProcessingStateError(
          `Could not determine AI state for conversation ${conversation.id}.`,
          { cause: error }
        );
      }
      if (!isAiHandlingActive(currentState)) {
        throw new AIProcessingBlockedError("conversation_in_manual_mode");
      }
    }

    let sourceMessageId = options.sourceMessageId ?? null;
    if (options.persistCustomer !== false) {
      try {
        const persistedMessage = await addMessage(
          conversation.id,
          businessId,
          "customer",
          message,
          channel
        );
        sourceMessageId = persistedMessage.id;
      } catch (error) {
        throw new AIProcessingStateError(
          `Could not persist the customer message for conversation ${conversation.id}.`,
          { cause: error }
        );
      }
    }

    let stateResults;
    try {
      stateResults = await Promise.all([
        supabaseAdmin
          .from("businesses")
          .select("*")
          .eq("id", businessId)
          .single(),
        supabaseAdmin
          .from("ai_settings")
          .select("*")
          .eq("business_id", businessId)
          .single(),
        supabaseAdmin
          .from("services")
          .select("*")
          .eq("business_id", businessId)
          .eq("is_active", true),
        supabaseAdmin
          .from("faqs")
          .select("*")
          .eq("business_id", businessId)
          .eq("is_active", true),
        supabaseAdmin
          .from("business_hours")
          .select("*")
          .eq("business_id", businessId),
        supabaseAdmin
          .from("google_calendar_tokens")
          .select("id")
          .eq("business_id", businessId)
          .maybeSingle(),
      ]);
    } catch (error) {
      throw new AIProcessingStateError(
        `Could not load AI context for business ${businessId}.`,
        { cause: error }
      );
    }

    const [
      businessResult,
      aiSettingsResult,
      servicesResult,
      faqsResult,
      businessHoursResult,
      calendarTokenResult,
    ] = stateResults;
    const contextError = stateResults.find((result) => result.error)?.error;
    if (contextError) {
      throw new AIProcessingStateError(
        `Could not load AI context for business ${businessId}.`,
        { cause: contextError }
      );
    }

    const business = businessResult.data;
    const aiSettings = aiSettingsResult.data;
    const services = servicesResult.data;
    const faqs = faqsResult.data;
    const businessHours = businessHoursResult.data;
    const calendarToken = calendarTokenResult.data;

    if (!business || !aiSettings) {
      throw new AIProcessingStateError(
        `Business ${businessId} is missing required AI configuration.`
      );
    }

    // Snapshot goal configuration from this turn's fresh business read. Never
    // re-read it while carrying an action toward the delivery boundary.
    const primaryGoal = (business as Business).primary_goal;
    const isSignupGoal = primaryGoal === "signup";
    const signupGoalUrl = isSignupGoal
      ? (business as Business).goal_url
      : null;
    if (isSignupGoal && !signupGoalUrl) {
      throw new AIProcessingStateError(
        `Signup goal for business ${businessId} is missing its goal URL.`
      );
    }

    const canBookDirectly = canUseFeature(entitlements, "direct_booking");
    const hasCalendar = canBookDirectly && !!calendarToken;
    let history;
    try {
      history = await getConversationHistory(conversation.id);
    } catch (error) {
      throw new AIProcessingStateError(
        `Could not load conversation history for ${conversation.id}.`,
        { cause: error }
      );
    }

    // This uncached read is the first-model execution fence. Everything from
    // here through the Anthropic call is synchronous, so the same snapshot
    // controls both whether AI may run and whether booking prompt/tools exist.
    const modelOperationalControls =
      await assertAIProcessingOperationallyAllowed(businessId, channel);
    const bookingOperationallyAvailable =
      modelOperationalControls.bookingsPausedAt === null;

    // Stored settings survive downgrades and operational pauses. Effective
    // prompt/tool behavior is derived from a copy and never mutates the row.
    const effectiveAiSettings: AISettings = {
      ...(aiSettings as AISettings),
      guardrails: canUseFeature(entitlements, "advanced_guardrails")
        ? (aiSettings as AISettings).guardrails
        : [],
    };

    const buildModelSurface = (bookingAvailable: boolean) => {
      const system = buildSystemPrompt(
        business as Business,
        effectiveAiSettings,
        (services ?? []) as Service[],
        (faqs ?? []) as FAQ[],
        (businessHours ?? []) as BusinessHours[],
        hasCalendar,
        channel,
        bookingAvailable
      );
      const requestTools: Anthropic.Tool[] = [...contactTools];
      if (isSignupGoal) {
        requestTools.push(...signupGoalTools);
      } else if (
        shouldIncludeBookingRequestTools(
          aiSettings as AISettings,
          bookingAvailable
        )
      ) {
        requestTools.push(...bookingRequestTools);
      } else if (
        shouldIncludeCalendarTools(
          aiSettings as AISettings,
          hasCalendar,
          bookingAvailable
        )
      ) {
        requestTools.push(...calendarTools);
      }
      return { system, tools: requestTools };
    };

    const initialModelSurface = buildModelSurface(
      bookingOperationallyAvailable
    );

    // The current customer message is already in history (either persisted
    // above or by a durable webhook caller), so do not append it a second time.
    const messages: Anthropic.MessageParam[] = buildConversationMessages(history);

    let enabledToolNames = new Set(
      initialModelSurface.tools.map((tool) => tool.name)
    );

    // Build API params
    let apiParams: Anthropic.MessageCreateParamsNonStreaming = {
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: initialModelSurface.system,
      messages,
      tools: initialModelSurface.tools,
    };

    let response = await anthropic.messages.create(apiParams);
    let loopCount = 0;
    const maxLoops = 3;
    let goalLinkToolUsed = false;
    let suppressCollectForFollowup = false;

    // Tool-calling loop
    while (response.stop_reason === "tool_use" && loopCount < maxLoops) {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) break;

      // Execute ALL tool calls and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUseBlock of toolUseBlocks) {
        let toolResult: string;
        if (toolUseBlock.name === "save_contact_name" || toolUseBlock.name === "save_contact_email") {
          await assertAIProcessingOperationallyAllowed(businessId, channel);
          toolResult = await executeContactTool(
            contact.id,
            toolUseBlock.name,
            toolUseBlock.input as Record<string, unknown>
          );
        } else if (toolUseBlock.name === "offer_goal_link") {
          await assertAIProcessingOperationallyAllowed(businessId, channel);
          if (
            !isSignupGoal ||
            !signupGoalUrl ||
            !enabledToolNames.has(toolUseBlock.name)
          ) {
            toolResult =
              "That tool is not enabled for this business. Do not perform the action.";
          } else {
            goalLinkToolUsed = true;
            toolResult =
              `Offer this exact link in your direct reply to the customer's current message: ${signupGoalUrl} ` +
              "Do not promise a callback, booking, follow-up, or any other action beyond providing the link.";
          }
        } else if (toolUseBlock.name === "record_booking_request") {
          const bookingRequestResult = await executeBookingRequestTool({
            businessId,
            contactId: contact.id,
            conversationId: conversation.id,
            sourceMessageId,
            toolInput: toolUseBlock.input as Record<string, unknown>,
            toolWasExposed: enabledToolNames.has(toolUseBlock.name),
            persistBookingRequests:
              options.persistBookingRequests !== false,
            channel,
          });
          toolResult = bookingRequestResult.content;
          suppressCollectForFollowup ||=
            bookingRequestResult.suppressCollectForFollowup;
        } else if (
          toolUseBlock.name === "check_availability" ||
          toolUseBlock.name === "create_booking"
        ) {
          const toolOperationalControls =
            await assertAIProcessingOperationallyAllowed(businessId, channel);
          if (toolOperationalControls.bookingsPausedAt !== null) {
            toolResult = BOOKING_UNAVAILABLE_TOOL_RESULT;
          } else if (!enabledToolNames.has(toolUseBlock.name)) {
            toolResult =
              "That tool is not enabled for this business. Do not perform the action.";
          } else {
            toolResult = await executeCalendarTool(
              businessId,
              toolUseBlock.name,
              toolUseBlock.input as Record<string, unknown>,
              (business as Business).timezone,
              contactPhone,
              contact.id,
              conversation.id,
              sourceMessageId
            );
          }
        } else {
          toolResult =
            "That tool is not enabled for this business. Do not perform the action.";
        }
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          content: toolResult,
        });
      }

      // Add assistant's response (with tool uses) and ALL tool results
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: toolResults,
      });

      // The same fresh snapshot that gates each follow-up model call also
      // rebuilds its booking prompt and tools. A pause that lands during a
      // tool iteration therefore cannot leave calendar capabilities visible.
      const followupOperationalControls =
        await assertAIProcessingOperationallyAllowed(businessId, channel);
      const followupModelSurface = buildModelSurface(
        followupOperationalControls.bookingsPausedAt === null &&
          !suppressCollectForFollowup
      );
      enabledToolNames = new Set(
        followupModelSurface.tools.map((tool) => tool.name)
      );
      apiParams = {
        ...apiParams,
        system: followupModelSurface.system,
        messages,
        tools: followupModelSurface.tools,
      };
      response = await anthropic.messages.create(apiParams);
      loopCount++;
    }

    // Extract the final text response
    const textBlock = response.content.find(
      (block): block is Anthropic.TextBlock => block.type === "text"
    );
    const rawResponseText = textBlock?.text || FALLBACK_MESSAGE;
    let parsedResponse: ParsedKnowledgeGapSignal;
    try {
      parsedResponse = parseKnowledgeGapSignal(rawResponseText);
    } catch (error) {
      console.error("[ai-engine] Knowledge-gap signal parsing failed:", error);
      parsedResponse = {
        text: stripExactKnowledgeGapSignal(rawResponseText),
        knowledgeGapDetected: false,
      };
    }
    const responseText = parsedResponse.text || FALLBACK_MESSAGE;
    const actions: GoalLinkOfferedAction[] =
      isSignupGoal &&
      signupGoalUrl &&
      goalLinkToolUsed &&
      sourceMessageId &&
      responseText.includes(signupGoalUrl)
        ? [
            {
              kind: "goal_link_offered",
              goalAtEvent: "signup",
              channel,
              contactId: contact.id,
              conversationId: conversation.id,
              sourceMessageId,
              idempotencyKey: buildGoalLinkIdempotencyKey(
                businessId,
                sourceMessageId
              ),
            },
          ]
        : [];

    let assistantMessageId: string | null = null;
    if (options.persistAssistant !== false) {
      await assertAIProcessingOperationallyAllowed(businessId, channel);
      try {
        const persistedAssistantMessage = await addMessage(
          conversation.id,
          businessId,
          "assistant",
          responseText,
          channel
        );
        assistantMessageId = persistedAssistantMessage.id;
      } catch (error) {
        throw new AIProcessingStateError(
          `Could not persist the assistant message for conversation ${conversation.id}.`,
          { cause: error }
        );
      }
    }

    const leadScoreIncrease = scoreMessage(message);
    if (leadScoreIncrease > 0) {
      await assertAIProcessingOperationallyAllowed(businessId, channel);
      await incrementLeadScore(contact.id, leadScoreIncrease);
    }

    await assertAIProcessingOperationallyAllowed(businessId, channel);
    return {
      text: responseText,
      knowledgeGapDetected: parsedResponse.knowledgeGapDetected,
      conversationId: conversation.id,
      sourceMessageId,
      actions,
      assistantMessageId,
    };
  } catch (error) {
    if (
      error instanceof AIProcessingBlockedError ||
      error instanceof AIProcessingStateError ||
      error instanceof EntitlementResolutionError ||
      isOperationalControlsResolutionError(error)
    ) {
      throw error;
    }
    console.error("Error processing incoming message:", error);
    await assertAIProcessingOperationallyAllowed(businessId, channel);
    return {
      text: FALLBACK_MESSAGE,
      knowledgeGapDetected: false,
      conversationId: null,
      sourceMessageId: null,
      actions: [],
      assistantMessageId: null,
    };
  }
}
