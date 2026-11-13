import { describe, expect, it } from "vitest";
import {
  isManualMethod,
  isPhoneEmail,
  isValidPhone,
  isValidReference,
  normalizePhone,
  normalizeReference,
  phoneEmail,
} from "../supabase/functions/_shared/validation.ts";

describe("numéro de téléphone", () => {
  it("accepte les formats courants", () => {
    expect(normalizePhone("+225 07 08 09 10 11")).toBe("0708091011");
    expect(normalizePhone("00225-05.66.77.88.99")).toBe("0566778899");
    expect(isValidPhone("07 08 09 10 11")).toBe(true);
    expect(isValidPhone("0808091011")).toBe(false);
  });
});

describe("compte créé avec un numéro", () => {
  it("adresse interne, reconnaissable, jamais livrable", () => {
    expect(phoneEmail("07 08 09 10 11")).toBe("0708091011@telephone.previenergie.invalid");
    expect(isPhoneEmail("0708091011@TELEPHONE.previenergie.invalid")).toBe(true);
    expect(isPhoneEmail("awa@exemple.com")).toBe(false);
    expect(isPhoneEmail(null)).toBe(false);
  });
});

describe("paiement manuel", () => {
  it("moyens acceptés", () => {
    expect(isManualMethod("wave")).toBe(true);
    expect(isManualMethod("mtn_momo")).toBe(true);
    expect(isManualMethod("carte")).toBe(false);
    expect(isManualMethod(undefined)).toBe(false);
  });
  it("identifiant de transaction recopié du SMS", () => {
    expect(normalizeReference(" mp2305 12.1544 ")).toBe("MP230512.1544");
    expect(isValidReference("MP230512.1544.A12345")).toBe(true);
    expect(isValidReference("t_7c2d 9x4k")).toBe(true);
    expect(isValidReference("abc")).toBe(false);
    expect(isValidReference("REF#123!")).toBe(false);
    expect(isValidReference("A".repeat(41))).toBe(false);
  });
});
