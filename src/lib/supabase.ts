import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://eyinimyrycqaafupkaaa.supabase.co';

const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5aW5pbXlyeWNxYWFmdXBrYWFhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzOTEzNjAsImV4cCI6MjExMDk2NzM2MH0.s8hXWZ7FEg8CF0gccz9_txft-2nui1bEX_NPosdHaZ4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
