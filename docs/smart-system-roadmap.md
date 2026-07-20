# Smart System Roadmap

## 1. Core idea

SimplAssist should become smarter by turning business-approved corrections and measurable customer outcomes into structured knowledge, not by automatically training on every conversation. The most valuable feedback loop connects what customers ask, how the AI and business respond, and whether the interaction produces a useful result such as a qualified lead or booked appointment.

## 2. Knowledge Gap Loop

The Knowledge Gap Loop would identify conversations where the assistant may be missing business-specific knowledge, including when it expresses uncertainty, a customer repeats a question, an owner takes over, or the owner's answer materially differs from the AI response. SimplAssist could turn those signals into an "Improve My Assistant" inbox with suggested FAQs, service details, escalation rules, or preferred wording.

The business owner would approve, edit, or dismiss every suggestion before it affects future responses. This keeps business knowledge accurate and tenant-specific while allowing each assistant to improve over time without creating hidden or uncontrolled model memory.

Useful supporting signals include:

- The question or topic that created the gap
- Whether the AI answered, deferred, failed, or triggered a human takeover
- An optional takeover or correction reason from the owner
- The owner's eventual response
- Whether a suggested FAQ or rule was approved, edited, or dismissed
- Whether similar questions decrease after the knowledge is added

## 3. Appointment and outcome tracking

SimplAssist should eventually store its own appointment record whenever the AI or a human creates a booking, linked to the originating business, contact, conversation, service, and Google Calendar event. This creates the missing connection between a conversation and its business result instead of relying only on the external calendar event.

The initial record should capture the scheduled time, booking source, service, Google event ID, and status. Later, the business could mark an appointment as completed, canceled, or no-show and optionally record an estimated or realized value.

Outcome tracking would support:

- Conversation-to-appointment conversion reporting
- Measurement of missed-call recovery
- AI-booked versus human-booked comparisons
- Follow-up and no-show workflows
- Better lead scoring based on real outcomes
- Clearer reporting of the value SimplAssist produces

AI-run instrumentation should accompany this work so individual responses can be connected to the model and prompt version, tools used, tool success or failure, token usage, latency, fallback state, human takeover, and eventual outcome. This information is for evaluation, cost control, and product improvement; raw transcripts should not be shared across businesses or automatically converted into permanent knowledge.

## 4. Build order

### Now

- Verify the tier walls and server-side entitlement behavior in the real product.
- Launch and observe the landscaper pilot.
- Define a small, stable event vocabulary for AI replies, tool calls, takeovers, bookings, and outcomes.
- Specify the minimum AI-run and SimplAssist appointment records, including privacy, retention, deletion, and tenant-isolation requirements.
- Keep the current lead score as a simple early signal rather than treating it as a reliable prediction model.

### After pilot

- Add AI-run instrumentation for model, prompt version, tokens, latency, tool activity, fallbacks, and response linkage.
- Persist SimplAssist appointment records and connect them to contacts and conversations.
- Add basic appointment statuses and conversation-to-appointment reporting.
- Add lightweight owner feedback such as helpful, incorrect, missing business information, or should have handed off.
- Record takeover timing and an optional reason.
- Introduce an owner-reviewed "Improve My Assistant" inbox for suggested FAQs and business rules.
- Use approved knowledge and measured outcomes to improve per-business responses and lead prioritization.

### Much later

- Add completed, canceled, and no-show workflows with follow-up automation.
- Provide de-identified industry patterns and benchmarks when the sample size is large enough to be meaningful.
- Recommend onboarding defaults and FAQ templates by business type based on aggregated patterns.
- Evaluate whether outcome-based lead models outperform deterministic rules.
- Consider specialized model training only if SimplAssist has a large set of clean, consented, redacted, and consistently labeled examples.

### Not doing

- Automatically training on every customer conversation.
- Sharing raw transcripts or business-specific answers across tenants.
- Automatically publishing inferred FAQs, policies, prices, or service rules without owner approval.
- Building hidden personality profiles or inferring sensitive traits about contacts.
- Treating a human takeover as proof that the AI was wrong without additional context.
- Fine-tuning a custom model before structured feedback and outcome data demonstrate a clear need.

## 5. First candidate build

AI-run and appointment instrumentation is the first candidate build after the tier walls are verified and the landscaper pilot is live.
