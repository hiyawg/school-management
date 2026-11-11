import { createClient } from "@supabase/supabase-js";

const env = import.meta.env;

if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY (the school project). See .env.example.");
}

// The school project: its own database and accounts. School data: supabase.from("classes") → sms.classes
export const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  db: { schema: "sms" },
});

// The education project, read-only with its public key and no sign-in: only the curriculum
// tables that are already public there (grades, subjects, unit, topic, skills, exam_sets).
export const curriculum = env.VITE_CURRICULUM_SUPABASE_URL && env.VITE_CURRICULUM_SUPABASE_KEY
  ? createClient(env.VITE_CURRICULUM_SUPABASE_URL, env.VITE_CURRICULUM_SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "sms-curriculum" },
    })
  : null;
