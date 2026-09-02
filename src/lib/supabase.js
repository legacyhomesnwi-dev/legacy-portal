import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  // Not fatal in dev — the app still renders, but auth and data calls will fail
  // until you copy .env.example to .env and set VITE_SUPABASE_ANON_KEY.
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in the anon key.'
  )
}

export const supabase = createClient(
  supabaseUrl ?? 'https://ajjkcmxytylcrjopxade.supabase.co',
  supabaseAnonKey ?? 'public-anon-key-missing'
)
