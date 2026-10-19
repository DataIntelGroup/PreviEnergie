import type { Channel } from "@shared/reglages.ts";
import type { MeterKind } from "@shared/prevision.ts";
import type { PaymentMethod } from "@shared/validation.ts";

export type Role = "user" | "support" | "admin";

export interface Profile {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  commune: string | null;
  source: string | null;
  role: Role;
  plan_code: string;
  plan_expires_at: string | null;
  suspended: boolean;
  channels: Channel[];
  whatsapp_consent_at: string | null;
  sms_consent_at: string | null;
  quiet_start: string;
  quiet_end: string;
  created_at: string;
}

export interface Plan {
  code: string;
  name: string;
  description: string;
  price_fcfa: number;
  max_meters: number;
  channels: Channel[];
  history_days: number | null;
  sort: number;
  active: boolean;
}

export interface Meter {
  id: string;
  user_id: string;
  name: string;
  kind: MeterKind;
  number: string | null;
  created_at: string;
}

export interface ReadingRow {
  id: string;
  meter_id: string;
  taken_at: string;
  value: number;
  source: "photo" | "manuel";
  photo_path: string | null;
  created_at: string;
}

export interface RechargeRow {
  id: string;
  meter_id: string;
  purchased_at: string;
  kwh: number;
  amount_fcfa: number;
  code: string | null;
  payment_method: PaymentMethod | null;
  source: "photo" | "manuel" | "sms";
  photo_path: string | null;
  created_at: string;
}

export interface AlertRow {
  id: number;
  meter_id: string | null;
  type: string;
  channel: Channel;
  status: "sent" | "failed";
  message: string | null;
  sent_at: string;
}

export interface PaymentRow {
  id: string;
  plan_code: string;
  amount_fcfa: number;
  transaction_id: string;
  status: "pending" | "accepted" | "refused";
  method: string | null;
  period_end: string | null;
  created_at: string;
}

export function isProfileComplete(p: Profile | null): boolean {
  return !!p && !!p.first_name && !!p.last_name && !!p.phone;
}

export function effectivePlanCode(p: Profile | null, now = new Date()): string {
  if (!p || p.plan_code === "gratuit") return "gratuit";
  return !p.plan_expires_at || new Date(p.plan_expires_at) > now ? p.plan_code : "gratuit";
}
