import { describe, expect, it } from "vitest";
import { mapCampaignStatus } from "./statusMapper";

const VERIFIED_PRODUCTION_EVENTS = [
  {
    data: {
      id: "04b94a66-d98b-46b1-a3da-299c2ac18241",
      event_type: "10dlc.campaign.update",
      occurred_at: "2026-07-27T20:39:22.993+00:00",
      payload: {
        brandId: "4b20019d-e93e-d697-b8ee-c6233e9bf533",
        campaignId: "4b30019f-8814-cb6c-1e77-950fa70e0410",
        createDate: "2026-07-22T04:30:38.000Z",
        cspId: "TNX",
        description: "Campaign is now provisioned",
        isTMobileRegistered: true,
        status: "ACCEPTED",
        type: "VERIFIED",
      },
    },
  },
  {
    data: {
      id: "fdf7d442-8be4-49ef-8470-e01ade0e8807",
      event_type: "10dlc.campaign.update",
      occurred_at: "2026-07-27T20:39:25.476+00:00",
      payload: {
        brandId: "4b20019d-e93e-d697-b8ee-c6233e9bf533",
        campaignId: "4b30019f-8814-cb6c-1e77-950fa70e0410",
        createDate: "2026-07-22T04:30:38.000Z",
        cspId: "TNX",
        description: "Campaign is now provisioned",
        isTMobileRegistered: true,
        status: "ACCEPTED",
        type: "VERIFIED",
      },
    },
  },
] as const;

describe("mapCampaignStatus", () => {
  it.each(VERIFIED_PRODUCTION_EVENTS)(
    "maps production VERIFIED event $data.id to terminal approval",
    (event) => {
      const payload = event.data.payload;

      expect(
        mapCampaignStatus({
          campaignStatus: null,
          submissionStatus: null,
          status: payload.status,
          notificationType: payload.type,
        })
      ).toEqual({ dbStatus: "approved", isTerminal: true });
    }
  );

  it("maps the documented VERIFIED shape without a high-level status", () => {
    expect(
      mapCampaignStatus({
        campaignStatus: null,
        submissionStatus: null,
        status: null,
        notificationType: "VERIFIED",
      })
    ).toEqual({ dbStatus: "approved", isTerminal: true });
  });

  it.each(["TELNYX_REVIEW", "MNO_REVIEW"])(
    "keeps %s ACCEPTED intermediate",
    (notificationType) => {
      expect(
        mapCampaignStatus({
          campaignStatus: null,
          submissionStatus: null,
          status: "ACCEPTED",
          notificationType,
        })
      ).toEqual({ dbStatus: null, isTerminal: false });
    }
  );

  it("lets the richer MNO_PROVISIONED status outrank generic ACCEPTED", () => {
    expect(
      mapCampaignStatus({
        campaignStatus: "MNO_PROVISIONED",
        submissionStatus: "CREATED",
        status: "ACCEPTED",
        notificationType: "TELNYX_REVIEW",
      })
    ).toEqual({ dbStatus: "approved", isTerminal: true });
  });

  it.each(["MNO_PENDING", "TCR_ACCEPTED"])(
    "lets VERIFIED outrank lagging detailed status %s",
    (campaignStatus) => {
      expect(
        mapCampaignStatus({
          campaignStatus,
          submissionStatus: "PENDING",
          status: "ACCEPTED",
          notificationType: "VERIFIED",
        })
      ).toEqual({ dbStatus: "approved", isTerminal: true });
    }
  );

  it("lets explicit rejection outrank a contradictory VERIFIED type", () => {
    expect(
      mapCampaignStatus({
        campaignStatus: null,
        submissionStatus: null,
        status: "REJECTED",
        notificationType: "VERIFIED",
      })
    ).toEqual({ dbStatus: "rejected", isTerminal: true });
  });

  it("lets an expired campaign outrank stale provisioning metadata", () => {
    expect(
      mapCampaignStatus({
        campaignStatus: "MNO_PROVISIONED",
        submissionStatus: "CREATED",
        status: "EXPIRED",
      })
    ).toEqual({ dbStatus: "rejected", isTerminal: true });
  });

  it("fails closed on VERIFIED with an unsupported high-level status", () => {
    expect(
      mapCampaignStatus({
        campaignStatus: null,
        submissionStatus: null,
        status: "DORMANT",
        notificationType: "VERIFIED",
      })
    ).toEqual({ dbStatus: null, isTerminal: false });
  });

  it("normalizes provider enum casing and whitespace", () => {
    expect(
      mapCampaignStatus({
        campaignStatus: "  mno_provisioned ",
        submissionStatus: "pending",
      })
    ).toEqual({ dbStatus: "approved", isTerminal: true });
  });

  it("does not infer approval from descriptive metadata or bare acceptance", () => {
    const payloadWithNonStatusMetadata = {
      status: "ACCEPTED",
      description: "Campaign is now provisioned",
      isTMobileRegistered: true,
    };

    expect(mapCampaignStatus(payloadWithNonStatusMetadata)).toEqual({
      dbStatus: null,
      isTerminal: false,
    });
  });
});
