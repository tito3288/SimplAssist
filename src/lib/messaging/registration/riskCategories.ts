import type { A2pRiskChecklistAnswer } from "@/types/database";

export const A2P_RISK_CHECKLIST_ANSWERS = [
  "none",
  "restricted",
  "not_sure",
] as const satisfies readonly A2pRiskChecklistAnswer[];

export const A2P_RISK_SELECTIONS = [
  "lead_gen_seo",
  "marketing_agency",
  "affiliate_marketing",
  "mlm_income",
  "high_risk_finance",
  "cannabis_cbd",
  "prescription_pharmacy",
  "gambling",
  "adult_dating",
  "firearms_weapons",
  "political",
  "alcohol_tobacco_vape",
  "other_regulated_deceptive",
] as const;

export type A2pRiskSelection = (typeof A2P_RISK_SELECTIONS)[number];

export const A2P_RISK_SELECTION_LABELS: Record<A2pRiskSelection, string> = {
  lead_gen_seo: "Lead generation, SEO, bought leads, prospect lists, or cold outreach",
  marketing_agency: "Marketing agency services",
  affiliate_marketing: "Affiliate marketing or referral offers",
  mlm_income: "Make-money-online, passive income, MLM, or network marketing",
  high_risk_finance:
    "Payday loans, debt relief, credit repair, crypto, stock trading, or investment promises",
  cannabis_cbd: "Cannabis, CBD, hemp, marijuana, or related products",
  prescription_pharmacy: "Prescription drugs, pharmacy, or telemedicine prescriptions",
  gambling: "Gambling, casino, sports betting, sweepstakes, or lottery-style offers",
  adult_dating: "Adult content, escort services, sexual content, dating, or hookup services",
  firearms_weapons: "Firearms, weapons, or ammunition",
  political: "Political messaging, donations, polling, advocacy, or campaign work",
  alcohol_tobacco_vape: "Alcohol, tobacco, vaping, or other age-gated products",
  other_regulated_deceptive: "Other regulated, deceptive, illegal, or scam-like services",
};

export const A2P_RISK_CUSTOMER_REVIEW_MESSAGE =
  "Carriers do not allow SMS registration for some business types and website content. We need to review this before submitting so you do not pay a fee for a likely rejection.";

export const A2P_RISK_BLOCKED_MESSAGE =
  "We found business or website content that carriers commonly reject for SMS registration. Please update the website or contact support before submitting.";

export const A2P_RISK_PASSED_MESSAGE =
  "Your SMS use case looks ready for carrier review.";

export function isA2pRiskSelection(value: string): value is A2pRiskSelection {
  return (A2P_RISK_SELECTIONS as readonly string[]).includes(value);
}
