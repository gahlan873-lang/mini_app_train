import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.8/mod.ts";

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

function parseInitData(initData: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheck = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  return { hash, dataCheck, params };
}

async function verifyTelegram(initData: string, botToken: string): Promise<TelegramUser | null> {
  if (!initData) return null;
  const { hash, dataCheck, params } = parseInitData(initData);
  if (!hash) return null;
  const secret = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botToken));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataCheck));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex !== hash) return null;
  const userRaw = params.get("user");
  if (!userRaw) return null;
  const user = JSON.parse(userRaw) as TelegramUser;
  if (!user?.id) return null;
  return user;
}

Deno.serve(async (req) => {
  try {
    const { initData } = await req.json();
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET") || "";
    if (!botToken || !supabaseUrl || !serviceRole || !jwtSecret) {
      return new Response(JSON.stringify({ linked: false, error: "Missing env" }), { status: 500 });
    }

    const tgUser = await verifyTelegram(initData, botToken);
    if (!tgUser) {
      return new Response(JSON.stringify({ linked: false }), { status: 401 });
    }

    const supabase = createClient(supabaseUrl, serviceRole);
    const { data, error } = await supabase
      .from("user_links")
      .select("supabase_user_id")
      .eq("telegram_user_id", String(tgUser.id))
      .maybeSingle();

    if (error || !data?.supabase_user_id) {
      return new Response(JSON.stringify({ linked: false }), { status: 200 });
    }

    const access_token = await create(
      { alg: "HS256", typ: "JWT" },
      {
        aud: "authenticated",
        role: "authenticated",
        sub: data.supabase_user_id,
        exp: getNumericDate(60 * 60 * 24 * 30)
      },
      jwtSecret
    );

    return new Response(
      JSON.stringify({
        linked: true,
        supabase_user_id: data.supabase_user_id,
        access_token,
        refresh_token: ""
      }),
      { status: 200 }
    );
  } catch (_error) {
    return new Response(JSON.stringify({ linked: false }), { status: 500 });
  }
});
