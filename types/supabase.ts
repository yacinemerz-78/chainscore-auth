/**
 * Types TypeScript — Schéma Supabase MyChainScore Auth
 * À régénérer avec : npx supabase gen types typescript --project-id <id> > types/supabase.ts
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string | null;
          role: UserRole;
          telegram_chat_id: string | null;
          telegram_linked_at: string | null;
          telegram_link_token: string | null;
          telegram_token_expires: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name?: string | null;
          role?: UserRole;
          telegram_chat_id?: string | null;
          telegram_linked_at?: string | null;
          telegram_link_token?: string | null;
          telegram_token_expires?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          email?: string;
          full_name?: string | null;
          role?: UserRole;
          telegram_chat_id?: string | null;
          telegram_linked_at?: string | null;
          telegram_link_token?: string | null;
          telegram_token_expires?: string | null;
          updated_at?: string;
        };
      };
      portfolios: {
        Row: {
          id: string;
          user_id: string;
          coin_id: string;
          coin_symbol: string;
          coin_name: string;
          qty: number;
          invested_eur: number;
          added_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          coin_id: string;
          coin_symbol: string;
          coin_name: string;
          qty: number;
          invested_eur: number;
          added_at?: string;
          updated_at?: string;
        };
        Update: {
          coin_symbol?: string;
          coin_name?: string;
          qty?: number;
          invested_eur?: number;
          updated_at?: string;
        };
      };
      subscriptions: {
        Row: {
          id: string;
          user_id: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          status: SubscriptionStatus;
          trial_end: string | null;
          current_period_end: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          status?: SubscriptionStatus;
          trial_end?: string | null;
          current_period_end?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          status?: SubscriptionStatus;
          trial_end?: string | null;
          current_period_end?: string | null;
          updated_at?: string;
        };
      };
      webauthn_credentials: {
        Row: {
          id: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          counter: number;
          device_name: string | null;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          credential_id: string;
          public_key: string;
          counter?: number;
          device_name?: string | null;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          counter?: number;
          device_name?: string | null;
          last_used_at?: string | null;
        };
      };
      webauthn_challenges: {
        Row: {
          id: string;
          user_id: string | null;
          challenge: string;
          type: "registration" | "authentication";
          expires_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          challenge: string;
          type: "registration" | "authentication";
          expires_at: string;
          created_at?: string;
        };
        Update: never;
      };
      activity_log: {
        Row: {
          id: string;
          event_type: ActivityEventType;
          user_id: string | null;
          user_email: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: {
          id?: string;
          event_type: ActivityEventType;
          user_id?: string | null;
          user_email?: string | null;
          metadata?: Json;
          created_at?: string;
        };
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: {
      has_active_subscription: { Args: { user_uuid: string }; Returns: boolean };
      is_admin: { Args: { user_uuid: string }; Returns: boolean };
      get_admin_stats: { Args: Record<never, never>; Returns: AdminStats };
    };
    Enums: {
      user_role: UserRole;
      subscription_status: SubscriptionStatus;
    };
  };
}

export type UserRole = "user" | "admin";
export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid";

export type ActivityEventType =
  | "signup"
  | "login"
  | "oauth_login"
  | "subscription_change"
  | "admin_action"
  | "passkey_reset"
  | "account_deleted"
  | "error";

export interface AdminStats {
  total_users: number;
  trialing: number;
  active: number;
  canceled: number;
  mrr_estimate: number;
}

// Helpers
export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Subscription = Database["public"]["Tables"]["subscriptions"]["Row"];
export type WebAuthnCredential = Database["public"]["Tables"]["webauthn_credentials"]["Row"];
export type ActivityLog = Database["public"]["Tables"]["activity_log"]["Row"];
export type PortfolioPosition = Database["public"]["Tables"]["portfolios"]["Row"];
