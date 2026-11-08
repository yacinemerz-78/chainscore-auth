/**
 * Journal d'activité — écrit en service_role pour bypasser RLS
 * Utilisé par les Server Actions et les API routes.
 */
import { createServiceClient } from "@/lib/supabase/server";
import type { ActivityEventType } from "@/types/supabase";

interface LogActivityParams {
  event_type: ActivityEventType;
  user_id?:   string | null;
  user_email?: string | null;
  metadata?:  Record<string, unknown>;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const service = await createServiceClient();
    await service.from("activity_log").insert({
      event_type: params.event_type,
      user_id:    params.user_id ?? null,
      user_email: params.user_email ?? null,
      metadata:   params.metadata ?? {},
    });
  } catch {
    // Non bloquant — le log ne doit jamais faire planter une action auth
    console.error("[activity] Erreur d'écriture du log");
  }
}
