/**
 * JCRGM Connect — App & Supabase Configuration
 * ----------------------------------------------------------------------------
 * You can paste your Supabase Project URL and Anon Key below before deploying
 * to GitHub Pages, OR enter them anytime directly inside the app's
 * "Supabase Cloud" settings modal!
 */
window.JCRGM_CONFIG = {
  APP_NAME: "JCRGM Connect",
  APP_TAGLINE: "Messenger • Ministry • Organization Hub",
  APP_VERSION: "2.4.0",

  // Optional: Hardcode your Supabase credentials here for all GitHub Pages visitors,
  // or leave empty to configure via the in-app "Supabase Cloud" button.
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",

  // Realtime channel namespace used for instant Broadcast, Presence, Typing & WebRTC signaling
  REALTIME_CHANNEL: "jcrgm-global-realtime-v2",

  // Default Organization / Ministry Info
  ORGANIZATION: {
    shortName: "JCRGM",
    fullName: "JCRGM Global Ministry & Community Network",
    motto: "Connecting Hearts, Empowering Teams, Advancing the Vision",
    defaultTheme: "dark" // 'dark', 'light', or 'royal'
  }
};
