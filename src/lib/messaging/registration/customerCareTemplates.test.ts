import { describe, expect, it } from "vitest";

import { buildMissedCallSmsCopy } from "@/lib/messaging/complianceCopy";

import {
  buildCustomerCareTemplateCopy,
  validateCustomerCareCopy,
} from "./customerCareTemplates";

describe("buildCustomerCareTemplateCopy", () => {
  it("uses the canonical English missed-call SMS as the carrier sample", () => {
    const copy = buildCustomerCareTemplateCopy({
      businessName: "Northstar Home Care",
      businessType: "general",
    });
    const expected =
      "Hi, this is Northstar Home Care — saw your call come in. Just reply here with what you need and we'll get you taken care of.\n\nMsg frequency varies. Msg & data rates may apply. Reply HELP for help or STOP to opt out.";

    expect(copy.sampleMessages[1]).toBe(expected);
    expect(copy.sampleMessages[1]).toBe(
      buildMissedCallSmsCopy("Northstar Home Care").en
    );
    expect(copy.sampleMessages[1]).toContain("\n\n");
    expect(copy.sampleMessages[1]).not.toContain("\\n\\n");
    expect(validateCustomerCareCopy(copy)).toEqual([]);
  });

  it("uses the canonical Spanish missed-call SMS for Spanish businesses", () => {
    const copy = buildCustomerCareTemplateCopy({
      businessName: "Northstar Home Care",
      businessType: "general",
      language: "es",
    });
    const expected =
      "Hola, somos Northstar Home Care — vimos tu llamada. Solo responde aquí con lo que necesitas y nos encargaremos de ayudarte.\n\nLa frecuencia de mensajes varía. Pueden aplicarse tarifas de mensajes y datos. Responde HELP para recibir ayuda o STOP para dejar de recibir mensajes.";

    expect(copy.sampleMessages[1]).toBe(expected);
    expect(copy.sampleMessages[1]).toBe(
      buildMissedCallSmsCopy("Northstar Home Care").es
    );
    expect(copy.sampleMessages[1]).toContain("\n\n");
    expect(copy.sampleMessages[1]).not.toContain("\\n\\n");
    expect(validateCustomerCareCopy(copy)).toEqual([]);
  });
});
