/**
 * The fictional business behind the demo dashboard — Manny's Plumbing, the same
 * cast as the homepage hero demo (Sarah M., the leaking water heater), so the
 * marketing animation and the dashboard screenshots tell one continuous story.
 *
 * Customer phone numbers use the fictional 555-01XX range and are stored as
 * 10-digit strings ("5125550134") because formatPhoneNumber only formats
 * exactly-10-digit input.
 */
export const DEMO_BUSINESS = {
  /** Never hits the network — any stable string works. */
  businessId: "demo-mannys-plumbing",
  name: "Manny's Plumbing",
  ownerEmail: "office@mannysplumbing.com",
  websiteUrl: "https://mannysplumbing.com",
} as const;
